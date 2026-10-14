using System.Globalization;
using System.Text.Json;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    public async Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(string contractId, string interval, long fromMs, long toMs,
        CancellationToken cancellationToken)
    {
        if (!Intervals.ContainsKey(interval) || fromMs < 0 || toMs <= fromMs ||
            toMs > timeProvider.GetUtcNow().AddDays(1).ToUnixTimeMilliseconds())
            throw new VenueReadException(venue.IntervalRequired);
        var market = (await CatalogueAsync(cancellationToken)).ActiveByKey(contractId)
            ?? throw new VenueReadException(venue.InactiveInstrument);
        return await ReadNativeCandlesAsync(market.Instrument!, interval, fromMs, toMs, cancellationToken);
    }

    public Task<IReadOnlyList<VenueCandle>> ReadNativeCandlesAsync(VenueInstrument market, string interval,
        long fromMs, long toMs, CancellationToken cancellationToken)
    {
        if (!Intervals.TryGetValue(interval, out var step) || fromMs < 0 || toMs <= fromMs ||
            toMs > timeProvider.GetUtcNow().AddDays(1).ToUnixTimeMilliseconds() ||
            market.VenueContractId is not { } id || id.Length is < 1 or > 20 || !id.All(char.IsAsciiDigit))
            throw new VenueReadException(venue.MarketRequired);
        return BoundedAsync<IReadOnlyList<VenueCandle>>(async ct =>
        {
            // One request only, never a full-history walk. Candle timestamps are ms; request bounds are seconds.
            var start = Math.Max(fromMs, toMs - MaxCandles * step);
            var count = Math.Min(MaxCandles, (toMs - start) / step + 1);
            var query = FormattableString.Invariant(
                $"candles?market_id={id}&resolution={interval}&start_timestamp={start / 1000}&end_timestamp={toMs / 1000}&count_back={count}&set_timestamp_to_end=false");
            using var document = await GetAsync(query, ct);
            return ReadCandles(document.RootElement, interval, start, toMs, step, venue);
        }, cancellationToken);
    }

    // https://apidocs.lighter.xyz/reference/candles.md: at most 500 candles, zero values omitted.
    // t/o/h/l/c/v are ms / prices / BASE volume. V is quote volume, i a trade ID, never a trade count.
    internal static IReadOnlyList<VenueCandle> ReadCandles(JsonElement root, string interval, long from, long to, long step,
        LighterExchange? exchange = null)
    {
        var json = (exchange ?? LighterExchange.Mainnet).Json;
        if (Text(json, root, "r") != interval) throw json.Invalid();
        var candles = new List<VenueCandle>();
        var times = new HashSet<long>();
        foreach (var row in Rows(json, root, "c", MaxCandles).EnumerateArray())
        {
            var at = json.Timestamp(json.Property(row, "t"), to).ToUnixTimeMilliseconds();
            if (!times.Add(at) || at % step != 0) throw json.Invalid();
            // No silent price default: missing OHLC cannot describe a usable candle.
            (string Text, decimal Number) Value(string name, bool optionalZero = false)
            {
                if (optionalZero && !row.TryGetProperty(name, out _)) return ("0", 0);
                var text = json.DecimalText(json.Property(row, name), numbers: true);
                var number = json.ParseDecimal(text);
                if (number < 0) throw json.Invalid();
                return (text, number);
            }
            var open = Value("o"); var high = Value("h"); var low = Value("l"); var close = Value("c"); var volume = Value("v", true);
            if (high.Number < low.Number || open.Number > high.Number || open.Number < low.Number ||
                close.Number > high.Number || close.Number < low.Number) throw json.Invalid();
            if (at < from) continue;
            candles.Add(new(at, checked(at + step - 1), open.Text, high.Text, low.Text, close.Text, volume.Text, null));
        }
        return candles.OrderBy(c => c.OpenTime).ToArray();
    }
}
