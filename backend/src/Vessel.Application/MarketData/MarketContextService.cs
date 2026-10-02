using System.Collections.Concurrent;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;

namespace Vessel.Application.MarketData;

// Read-only public venue statistics. Values keep the venue's decimal strings; nothing is derived.
public interface IMarketContextReader
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueMarketContext>> ReadMarketContextsAsync(CancellationToken cancellationToken);
}

public sealed record VenueMarketContext(
    string ContractId, string MarkPrice, string OraclePrice, string? MidPrice, string PreviousDayPrice,
    string DayNotionalVolume, string OpenInterest, string FundingRate, string? Premium);

public sealed record MarketContextDto(string VenueId, string Instrument, string MarkPrice, string OraclePrice,
    string? MidPrice, string PreviousDayPrice, string DayNotionalVolume, string OpenInterest, string FundingRate,
    string? Premium, DateTimeOffset ObservedAt, string Notice);

/// <summary>Bounded short-lived cache of one whole upstream snapshot per venue. Register as a singleton.</summary>
public sealed class MarketContextCache(TimeProvider time)
{
    private const int MaxEntries = 16;
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(10);
    private readonly ConcurrentDictionary<string, (DateTimeOffset Expires, DateTimeOffset Observed, IReadOnlyList<VenueMarketContext> Value)> entries = new();

    public (DateTimeOffset Observed, IReadOnlyList<VenueMarketContext> Value)? Get(string venueId) =>
        entries.TryGetValue(venueId, out var entry) && entry.Expires > time.GetUtcNow() ? (entry.Observed, entry.Value) : null;

    public void Set(string venueId, DateTimeOffset observed, IReadOnlyList<VenueMarketContext> value)
    {
        var now = time.GetUtcNow();
        if (entries.Count >= MaxEntries && !entries.ContainsKey(venueId)) entries.Clear();
        entries[venueId] = (now + Lifetime, observed, value);
    }
}

public sealed class MarketContextService(IWorkspaceStore store, IMarketContextReader reader, MarketContextCache cache, TimeProvider time)
{
    public const string Notice =
        "Venue market context for the primary perpetual DEX. Funding is the current hourly rate; open interest is in base units. Not a fill or valuation.";
    private const string VenueFailure = "The venue market read failed. Try again later.";

    public async Task<MarketContextDto> ContextAsync(Guid accountId, string? instrument, CancellationToken ct)
    {
        var account = await MarketDataGuard.AccountAsync(store, accountId, ct);
        instrument = MarketDataGuard.Instrument(instrument);
        if (reader.VenueId != account.VenueId)
            throw new WorkspaceException(502, VenueFailure);

        var snapshot = cache.Get(account.VenueId);
        if (snapshot is null)
        {
            IReadOnlyList<VenueMarketContext> raw;
            try
            {
                raw = await reader.ReadMarketContextsAsync(ct);
                ct.ThrowIfCancellationRequested();
            }
            catch (Exception ex) when (ex is VenueReadException or HttpRequestException ||
                ex is OperationCanceledException && !ct.IsCancellationRequested)
            {
                throw new WorkspaceException(502, VenueFailure);
            }
            var observed = time.GetUtcNow();
            cache.Set(account.VenueId, observed, raw);
            snapshot = (observed, raw);
        }

        var match = snapshot.Value.Value.FirstOrDefault(c => c.ContractId == instrument)
            ?? throw new WorkspaceException(400, "The instrument is not in the venue's primary perpetual catalogue.");
        return new MarketContextDto(account.VenueId, instrument, match.MarkPrice, match.OraclePrice, match.MidPrice,
            match.PreviousDayPrice, match.DayNotionalVolume, match.OpenInterest, match.FundingRate, match.Premium,
            snapshot.Value.Observed, Notice);
    }
}
