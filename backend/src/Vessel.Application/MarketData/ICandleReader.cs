namespace Vessel.Application.MarketData;

// Read-only public market data port, separate from account/portfolio reads.
// Prices and volume keep the venue's decimal strings; no financial arithmetic happens here.
public interface ICandleReader
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(
        string contractId, string interval, long fromMs, long toMs, CancellationToken cancellationToken);
}

public sealed record VenueCandle(
    long OpenTime, long CloseTime,
    string Open, string High, string Low, string Close, string Volume, int Trades);
