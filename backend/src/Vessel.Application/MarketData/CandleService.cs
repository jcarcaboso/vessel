using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;

namespace Vessel.Application.MarketData;

public sealed record CandleDto(long OpenTime, long CloseTime, string Open, string High, string Low, string Close,
    string Volume, int Trades);

public sealed record CandleResponseDto(string VenueId, string Instrument, string Interval, string PriceSource,
    IReadOnlyList<CandleDto> Candles, long RequestedFrom, long RequestedTo, DateTimeOffset RetrievedAt,
    bool HistoryExhausted, string Notice);

/// <summary>Tiny bounded short-lived cache for public candle responses. Register as a singleton.</summary>
public sealed class CandleCache(TimeProvider time)
{
    private const int MaxEntries = 256;
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(10);
    private readonly ConcurrentDictionary<string, (DateTimeOffset Expires, CandleResponseDto Value)> entries = new();

    public CandleResponseDto? Get(string key) =>
        entries.TryGetValue(key, out var entry) && entry.Expires > time.GetUtcNow() ? entry.Value : null;

    public void Set(string key, CandleResponseDto value)
    {
        var now = time.GetUtcNow();
        if (entries.Count >= MaxEntries)
        {
            foreach (var pair in entries.Where(pair => pair.Value.Expires <= now).ToList())
                entries.TryRemove(pair.Key, out _);
            if (entries.Count >= MaxEntries) entries.Clear();
        }
        entries[key] = (now + Lifetime, value);
    }
}

public sealed partial class CandleService(IWorkspaceStore store, ICandleReader reader, CandleCache cache, TimeProvider time)
{
    public const int MaxCandles = 500;
    public const string Notice =
        "Hyperliquid exposes only the latest 5,000 candles per interval. Prices are trade candles, not fills.";
    private static readonly TimeSpan MaxFuture = TimeSpan.FromDays(1);
    private const long CacheBucketMs = 10_000;

    private static readonly Dictionary<string, long> IntervalMs = new(StringComparer.Ordinal)
    {
        ["1m"] = 60_000L, ["3m"] = 3 * 60_000L, ["5m"] = 5 * 60_000L, ["15m"] = 15 * 60_000L,
        ["30m"] = 30 * 60_000L, ["1h"] = 3_600_000L, ["2h"] = 2 * 3_600_000L, ["4h"] = 4 * 3_600_000L,
        ["8h"] = 8 * 3_600_000L, ["12h"] = 12 * 3_600_000L, ["1d"] = 86_400_000L, ["3d"] = 3 * 86_400_000L,
        ["1w"] = 7 * 86_400_000L, ["1M"] = 31 * 86_400_000L
    };

    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$")]
    private static partial Regex InstrumentPattern();

    public async Task<CandleResponseDto> CandlesAsync(Guid accountId, string? instrument, string? interval, long? endTime, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var account = await store.AccountAsync(accountId, ct) ?? throw new WorkspaceException(404, "Account not found.");
        if (!account.IsEnabled)
            throw new WorkspaceException(409, "Enable the account before reading market data.");
        if (account.VenueId == "manual")
            throw new WorkspaceException(409, "No market data provider for manual accounts.");
        if (instrument is null || !InstrumentPattern().IsMatch(instrument))
            throw new WorkspaceException(400, "Instrument must be 1 to 32 letters, digits, hyphens or underscores.");
        if (interval is null || !IntervalMs.TryGetValue(interval, out var step))
            throw new WorkspaceException(400, "Interval must be one of 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M.");
        var now = time.GetUtcNow();
        if (endTime is <= 0 || endTime > now.Add(MaxFuture).ToUnixTimeMilliseconds())
            throw new WorkspaceException(400, "endTime must be a positive UTC millisecond timestamp, at most one day ahead.");
        if (reader.VenueId != account.VenueId)
            throw new WorkspaceException(502, VenueFailure);

        var to = endTime ?? now.ToUnixTimeMilliseconds() / CacheBucketMs * CacheBucketMs;
        var from = Math.Max(0, to - MaxCandles * step);
        var key = $"{account.VenueId}|{instrument}|{interval}|{from}|{to}";
        if (cache.Get(key) is { } hit) return hit;

        IReadOnlyList<VenueCandle> raw;
        try
        {
            raw = await reader.ReadCandlesAsync(instrument, interval, from, to, ct);
            ct.ThrowIfCancellationRequested();
        }
        catch (Exception ex) when (ex is VenueReadException or HttpRequestException ||
            ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw new WorkspaceException(502, VenueFailure);
        }

        var candles = raw.Where(c => c.OpenTime >= from && c.OpenTime <= to)
            .GroupBy(c => c.OpenTime).Select(g => g.Last()).OrderBy(c => c.OpenTime)
            .Select(c => new CandleDto(c.OpenTime, c.CloseTime, c.Open, c.High, c.Low, c.Close, c.Volume, c.Trades))
            .ToList();
        var result = new CandleResponseDto(account.VenueId, instrument, interval, "trades", candles, from, to,
            now, candles.Count == 0, Notice);
        cache.Set(key, result);
        return result;
    }

    private const string VenueFailure = "The venue candle read failed. Try again later.";
}
