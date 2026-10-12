using Vessel.Application.Venues;

namespace Vessel.Application.MarketData;

// Read-only public market data port, separate from account/portfolio reads.
// Prices and volume keep the venue's decimal strings; no financial arithmetic happens here.
public interface ICandleReader
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(
        string contractId, string interval, long fromMs, long toMs, CancellationToken cancellationToken);
    // The application has already resolved current metadata. Do not resolve the symbol again and race a replacement.
    Task<IReadOnlyList<VenueCandle>> ReadNativeCandlesAsync(VenueInstrument market, string interval, long fromMs, long toMs,
        CancellationToken cancellationToken) =>
        ReadCandlesAsync(market.VenueContractId ?? market.ContractId, interval, fromMs, toMs, cancellationToken);
}

/// <summary>One candle. <paramref name="Trades"/> is null when the venue does not report a trade count.</summary>
public sealed record VenueCandle(
    long OpenTime, long CloseTime,
    string Open, string High, string Low, string Close, string Volume, int? Trades);
