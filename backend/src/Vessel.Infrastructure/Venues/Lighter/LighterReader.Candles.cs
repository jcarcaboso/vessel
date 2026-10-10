using System.Globalization;
using System.Text.Json;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    public Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(string contractId, string interval, long fromMs, long toMs,
        CancellationToken cancellationToken)
    {
        if (!Intervals.TryGetValue(interval, out var step) || fromMs < 0 || toMs <= fromMs ||
            toMs > timeProvider.GetUtcNow().AddDays(1).ToUnixTimeMilliseconds())
            throw new VenueReadException("A native Lighter interval and a valid candle window are required.");
        return BoundedAsync<IReadOnlyList<VenueCandle>>(async ct =>
        {
            var catalogue = await CatalogueAsync(ct);
            var market = catalogue.ActiveByKey(contractId) ?? throw new VenueReadException("The instrument is not an active Lighter perpetual.");
            // One request only, never a full-history walk. Candle timestamps are ms; request bounds are seconds.
            var start = Math.Max(fromMs, toMs - MaxCandles * step);
            var count = Math.Min(MaxCandles, (toMs - start) / step + 1);
            var query = FormattableString.Invariant(
                $"candles?market_id={market.MarketId}&resolution={interval}&start_timestamp={start / 1000}&end_timestamp={toMs / 1000}&count_back={count}&set_timestamp_to_end=false");
            using var document = await GetAsync(query, ct);
            return ReadCandles(document.RootElement, interval, start, toMs, step);
        }, cancellationToken);
    }

    // https://apidocs.lighter.xyz/reference/candles.md: at most 500 candles, zero values omitted.
    // t/o/h/l/c/v are ms / prices / BASE volume. V is quote volume, i a trade ID, never a trade count.
    internal static IReadOnlyList<VenueCandle> ReadCandles(JsonElement root, string interval, long from, long to, long step)
    {
        if (Text(root, "r") != interval) throw Json.Invalid();
        var candles = new List<VenueCandle>();
        var times = new HashSet<long>();
        foreach (var row in Rows(root, "c", MaxCandles).EnumerateArray())
        {
            var at = Json.Timestamp(Json.Property(row, "t"), to).ToUnixTimeMilliseconds();
            if (!times.Add(at) || at % step != 0) throw Json.Invalid();
            // No silent price default: missing OHLC cannot describe a usable candle.
            (string Text, decimal Number) Value(string name, bool optionalZero = false)
            {
                if (optionalZero && !row.TryGetProperty(name, out _)) return ("0", 0);
                var text = Json.DecimalText(Json.Property(row, name), numbers: true);
                var number = Json.ParseDecimal(text);
                if (number < 0) throw Json.Invalid();
                return (text, number);
            }
            var open = Value("o"); var high = Value("h"); var low = Value("l"); var close = Value("c"); var volume = Value("v", true);
            if (high.Number < low.Number || open.Number > high.Number || open.Number < low.Number ||
                close.Number > high.Number || close.Number < low.Number) throw Json.Invalid();
            if (at < from) continue;
            candles.Add(new(at, checked(at + step - 1), open.Text, high.Text, low.Text, close.Text, volume.Text, null));
        }
        return candles.OrderBy(c => c.OpenTime).ToArray();
    }
}
