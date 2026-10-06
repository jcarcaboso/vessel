using System.Collections.Concurrent;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;

namespace Vessel.Application.MarketData;

public sealed record CandleDto(long OpenTime, long CloseTime, string Open, string High, string Low, string Close,
    string Volume, int? Trades);

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

public sealed class CandleService(IWorkspaceStore store, IVenueRegistry venues, CandleCache cache, TimeProvider time)
{
    public const int MaxCandles = 500;
    /// <summary>Used when the venue's descriptor has no notice of its own.</summary>
    public const string Notice = "Prices are trade candles, not fills.";
    private static readonly TimeSpan MaxFuture = TimeSpan.FromDays(1);
    private const long CacheBucketMs = 10_000;

    public async Task<CandleResponseDto> CandlesAsync(Guid accountId, string? instrument, string? interval, long? endTime, CancellationToken ct)
    {
        var account = await MarketDataGuard.AccountAsync(store, accountId, ct);
        instrument = MarketDataGuard.Instrument(instrument);
        var venue = venues.Descriptor(account.VenueId);
        (interval, var step) = MarketDataGuard.Interval(interval, venue);
        var now = time.GetUtcNow();
        if (endTime is <= 0 || endTime > now.Add(MaxFuture).ToUnixTimeMilliseconds())
            throw new WorkspaceException(400, "endTime must be a positive UTC millisecond timestamp, at most one day ahead.");
        if (venues.Candles(account.VenueId) is not { } reader)
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
            // Both window ends are inclusive, so an interval-aligned endTime can yield 501 opens; keep the newest 500.
            .TakeLast(MaxCandles)
            .Select(c => new CandleDto(c.OpenTime, c.CloseTime, c.Open, c.High, c.Low, c.Close, c.Volume, c.Trades))
            .ToList();
        var result = new CandleResponseDto(account.VenueId, instrument, interval, "trades", candles, from, to,
            now, candles.Count == 0, venue?.CandleNotice ?? Notice);
        cache.Set(key, result);
        return result;
    }

    private const string VenueFailure = "The venue candle read failed. Try again later.";
}
