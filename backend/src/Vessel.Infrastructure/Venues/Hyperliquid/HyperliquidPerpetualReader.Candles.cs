using System.Globalization;
using System.Text.Json;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

public sealed partial class HyperliquidPerpetualReader
{
    // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint (candleSnapshot):
    // only the most recent 5,000 candles are available; o/h/l/c/v are decimal strings.
    private const int MaxCandles = 5000;

    public Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(
        string contractId, string interval, long fromMs, long toMs, CancellationToken cancellationToken)
    {
        if (!IsPrimaryContract(contractId) || fromMs < 0 || toMs < fromMs)
            throw new VenueReadException("A primary perpetual contract and valid window are required.");
        return ReadBoundedAsync<IReadOnlyList<VenueCandle>>(async token =>
        {
            using var response = await ReadJsonAsync(new
            {
                type = "candleSnapshot",
                req = new { coin = contractId, interval, startTime = fromMs, endTime = toMs }
            }, token);
            return ReadCandles(response.RootElement, contractId, interval);
        }, cancellationToken);
    }

    private static List<VenueCandle> ReadCandles(JsonElement root, string contractId, string interval)
    {
        var array = Array(root);
        if (array.GetArrayLength() > MaxCandles)
            throw new VenueReadException(InvalidResponse);
        var candles = new List<VenueCandle>();
        foreach (var item in array.EnumerateArray())
        {
            if (Text(Property(item, "s")) != contractId || Text(Property(item, "i")) != interval)
                throw new VenueReadException(InvalidResponse);
            var open = Price(Property(item, "o")); var high = Price(Property(item, "h"));
            var low = Price(Property(item, "l")); var close = Price(Property(item, "c"));
            var volume = Price(Property(item, "v"));
            var trades = Property(item, "n");
            var openTime = Property(item, "t"); var closeTime = Property(item, "T");
            if (trades.ValueKind != JsonValueKind.Number || !trades.TryGetInt32(out var count) || count < 0 ||
                openTime.ValueKind != JsonValueKind.Number || !openTime.TryGetInt64(out var t) || t < 0 ||
                closeTime.ValueKind != JsonValueKind.Number || !closeTime.TryGetInt64(out var closedAt) || closedAt < t ||
                high.Value < Math.Max(Math.Max(open.Value, close.Value), low.Value) ||
                low.Value > Math.Min(open.Value, close.Value))
                throw new VenueReadException(InvalidResponse);
            candles.Add(new(t, closedAt, open.Text, high.Text, low.Text, close.Text, volume.Text, count));
        }
        return candles;
    }

    // Keeps the venue's exact string after proving it is a finite non-negative decimal.
    private static (string Text, decimal Value) Price(JsonElement element)
    {
        var value = Nonnegative(element);
        return (element.GetString()!, value);
    }
}
