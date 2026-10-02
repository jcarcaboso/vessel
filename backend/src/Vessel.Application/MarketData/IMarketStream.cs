namespace Vessel.Application.MarketData;

// Live, read-only public market data port. Values keep the venue's exact decimal strings.
// Observed prices are not fills; nothing here matches orders or persists data.
public interface IMarketStream
{
    string VenueId { get; }

    /// <summary>
    /// Registers a listener for one primary contract and candle interval. Registration is synchronous so
    /// capacity failures surface before a response starts. Throws <see cref="MarketStreamCapacityException"/>
    /// when the upstream subscription bound is reached. Dispose the result to leave.
    /// </summary>
    IMarketStreamSubscription Subscribe(string contractId, string interval);
}

public interface IMarketStreamSubscription : IDisposable
{
    /// <summary>Single reader. Completes when disposed or cancelled; slow readers see coalesced updates.</summary>
    IAsyncEnumerable<MarketStreamEvent> ReadAllAsync(CancellationToken cancellationToken);
}

public abstract record MarketStreamEvent;

public sealed record MarketCandleEvent(VenueCandle Candle) : MarketStreamEvent;

public sealed record MarketContextEvent(VenueMarketContext Context, DateTimeOffset ObservedAt) : MarketStreamEvent;

public sealed record MarketStatusEvent(MarketStreamState State, DateTimeOffset ObservedAt) : MarketStreamEvent;

public enum MarketStreamState { Live, Reconnecting, Stale }

public sealed class MarketStreamCapacityException(string message) : Exception(message);
