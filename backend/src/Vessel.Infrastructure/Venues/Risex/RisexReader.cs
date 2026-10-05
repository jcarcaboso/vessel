using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Risex;

/// <summary>
/// Read-only RISEx perpetuals adapter. Every read is public and keyed by the account's EVM address; Vessel holds no
/// session key and never signs. Composition supplies an HttpClient with BaseAddress https://api.rise.trade/ and an
/// explicit User-Agent (the API's firewall rejects some default client strings).
/// </summary>
public sealed partial class RisexReader(HttpClient httpClient, TimeProvider timeProvider, RisexCatalogueCache catalogueCache)
    : IPerpetualVenueReader, IVenueOrderReader, ICandleReader, IMarketContextReader
{
    // https://developer.rise.trade/llms.txt, checked October 5, 2026; shapes observed live the same day.
    // All timestamps are nanoseconds as decimal strings. See docs/architecture/risex-integration.md.
    public const string Id = "risex";
    private const string InvalidResponse = "RISEx returned an invalid or unsupported response.";
    private const string QuoteAsset = "USDC";
    private const int PageSize = 1000;
    private const int MaxFillPages = 2;
    private const int MaxCandles = 5000;
    private static readonly StrictJson Json = new(InvalidResponse);

    /// <summary>Native candle intervals in nanoseconds. Other intervals silently fall back to 1m upstream, so they are never requested.</summary>
    private static readonly IReadOnlyDictionary<string, long> IntervalMs = new Dictionary<string, long>(StringComparer.Ordinal)
    {
        ["1m"] = 60_000L, ["5m"] = 300_000L, ["15m"] = 900_000L, ["1h"] = 3_600_000L,
        ["4h"] = 14_400_000L, ["1d"] = 86_400_000L, ["1w"] = 604_800_000L
    };

    public static readonly VenueDescriptor Descriptor = new(Id, "RISEx", "read-only", VenueSources.EvmAddress,
        new VenueCapabilities(Sync: true, Instruments: true, Orders: true, Candles: true, MarketContext: true, Stream: false, StablecoinWallet: false),
        QuoteAsset: QuoteAsset, TradeUrlTemplate: "https://www.rise.trade/trade/{instrument}",
        Intervals: [.. IntervalMs.Keys], PriceRule: PriceRules.TickSize,
        CandleNotice: "RISEx trade candles from the venue's chart data. Refresh to update; prices are trade candles, not fills.",
        MarketContextNotice: "RISEx market context: mark and index price, 24-hour quote volume, open interest in base units and the current hourly funding rate. Not a fill or valuation.");

    private const string HistoryNotice =
        "Incomplete history: the latest RISEx fills only, at most 2,000 per refresh; older fills are not imported. " +
        "Closed PnL is net of fees as RISEx reports it. Account value is RISEx cross-margin equity in USDC.";
    private const string OrdersNotice =
        "RISEx orders: the latest 1,000 order records and TP/SL orders. A triggered TP/SL fills through a new order of its own.";

    public string VenueId => Id;

    private BoundedJsonHttp Http => new(httpClient, timeProvider, Json, "RISEx is unavailable. Try again later.", "RISEx read timed out.");

    private async Task<JsonDocument> GetAsync(string pathAndQuery, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, pathAndQuery);
        return await Http.SendAsync(request, ct);
    }

    private static JsonElement Data(JsonDocument document) => Json.Property(document.RootElement, "data");

    // ---- Catalogue ----

    /// <summary>A RISEx market and the Vessel key it maps to. Retired markets keep their key for history but are never selectable.</summary>
    internal sealed record RisexMarket(string MarketId, string Key, bool Active, VenueInstrument Instrument);

    internal sealed record RisexCatalogue(IReadOnlyList<RisexMarket> Markets)
    {
        public RisexMarket? ById(string marketId) => Markets.FirstOrDefault(m => m.MarketId == marketId);
        public RisexMarket? ActiveByKey(string key) => Markets.FirstOrDefault(m => m.Active && m.Key == key);
    }

    // "BTC/USDC", or "DOGE/USDC [deprecated-1779958099]" for a retired market beside a live one.
    [GeneratedRegex(@"^(?<asset>[A-Za-z0-9]{1,24})/USDC(?<retired> \[deprecated-\d{1,20}\])?$")]
    private static partial Regex MarketName();

    private Task<RisexCatalogue> CatalogueAsync(CancellationToken ct) => catalogueCache.GetAsync(async token =>
    {
        using var document = await GetAsync("/v1/markets", token);
        return ReadCatalogue(Data(document));
    }, ct);

    internal static RisexCatalogue ReadCatalogue(JsonElement data)
    {
        var markets = new List<RisexMarket>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var activeKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in Json.Array(Json.Property(data, "markets")).EnumerateArray())
        {
            var id = Json.Text(Json.Property(item, "market_id"), 20);
            if (!id.All(char.IsAsciiDigit) || !ids.Add(id)) throw Json.Invalid();
            var config = Json.Property(item, "config");
            var match = MarketName().Match(Json.Text(Json.Property(config, "name")));
            // A name the map cannot classify is left out rather than guessed.
            if (!match.Success || Json.Text(Json.Property(item, "quote_asset_symbol"), 16) != QuoteAsset) continue;
            var key = match.Groups["asset"].Value;
            var active = !match.Groups["retired"].Success && Json.Boolean(Json.Property(item, "active")) &&
                Json.Boolean(Json.Property(config, "unlocked"));
            if (active && !activeKeys.Add(key)) throw Json.Invalid();
            var leverage = Json.Positive(Json.Property(config, "max_leverage"));
            if (leverage != decimal.Truncate(leverage) || leverage > 1000) throw Json.Invalid();
            var category = Json.TextOrEmpty(Json.Property(item, "category"), 32);
            markets.Add(new(id, key, active, new VenueInstrument(key, Decimals(Json.Positive(Json.Property(config, "step_size"))),
                (int)leverage, QuoteAsset, Json.Positive(Json.Property(config, "step_price")),
                category.Length == 0 ? null : category, id)));
        }
        return new(markets);
    }

    private static int Decimals(decimal step)
    {
        var places = (decimal.GetBits(step / 1.0000000000000000000000000000m)[3] >> 16) & 0xff;
        return Math.Min(places, 28);
    }

    public async Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken cancellationToken) =>
        await Http.ReadBoundedAsync<IReadOnlyList<VenueInstrument>>(async token =>
            (await CatalogueAsync(token)).Markets.Where(m => m.Active).Select(m => m.Instrument).ToList(), cancellationToken);

    // ---- Account ----

    private static string Address(string? publicAddress) =>
        publicAddress is { Length: 42 } && publicAddress.StartsWith("0x", StringComparison.Ordinal) && publicAddress.Skip(2).All(char.IsAsciiHexDigit)
            ? publicAddress.ToLowerInvariant()
            : throw new VenueReadException("A valid 42-character hexadecimal public address is required.");

    public Task<PerpetualVenueReadResult> ReadAsync(string publicAddress, CancellationToken cancellationToken)
    {
        var address = Address(publicAddress);
        var latest = timeProvider.GetUtcNow().AddMinutes(5);
        return Http.ReadBoundedAsync(async token =>
        {
            var catalogue = await CatalogueAsync(token);
            using var portfolio = await GetAsync($"/v1/portfolio/details?account={address}", token);
            var snapshot = ReadSnapshot(Data(portfolio), catalogue, timeProvider.GetUtcNow());
            var fills = new List<VenueFill>();
            for (var page = 1; page <= MaxFillPages; page++)
            {
                using var history = await GetAsync($"/v1/trade-history?account={address}&limit={PageSize}&page={page}", token);
                var data = Data(history);
                fills.AddRange(ReadFills(data, catalogue, latest));
                if (!Json.Boolean(Json.Property(data, "has_next_page"))) break;
            }
            return new PerpetualVenueReadResult(snapshot,
                catalogue.Markets.Where(m => m.Active).Select(m => m.Instrument).ToList(),
                fills.GroupBy(f => (f.ContractId, f.SourceFillId)).Select(g => g.First()).OrderByDescending(f => f.OccurredAtUtc).ToList(),
                HistoryNotice);
        }, cancellationToken);
    }

    /// <summary>Signed sizes and decimal strings from portfolio details. RISEx reports no withdrawable amount, so it stays unknown.</summary>
    internal static VenueSnapshot ReadSnapshot(JsonElement data, RisexCatalogue catalogue, DateTimeOffset observedAt)
    {
        var summary = Json.Property(data, "summary");
        var positions = new List<VenuePosition>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in Json.Array(Json.Property(data, "positions")).EnumerateArray())
        {
            var sizeText = Json.TextOrEmpty(Json.Property(item, "size"), 64);
            if (sizeText.Length == 0) continue;
            var size = Json.ParseDecimal(sizeText);
            if (size == 0) continue;
            if (catalogue.ById(Json.Text(Json.Property(item, "market_id"), 20)) is not { } market) continue;
            if (!keys.Add(market.Key)) throw Json.Invalid();
            var leverage = Json.Nonnegative(Json.Property(item, "leverage"));
            positions.Add(new(market.Key, size, Json.Positive(Json.Property(item, "avg_entry_price")),
                Json.Number(Json.Property(item, "unrealized_pnl")), Json.Nonnegative(Json.Property(item, "initial_margin_requirement")),
                leverage > 0 && leverage == decimal.Truncate(leverage) && leverage <= 1000 ? (int)leverage : null));
        }
        return new VenueSnapshot(observedAt, "risex-perps-account",
            Json.Number(Json.Property(summary, "total_account_value")), null,
            Json.Nonnegative(Json.Property(summary, "total_initial_margin")), positions);
    }

    /// <summary>Unix nanoseconds as a decimal string, to millisecond precision, no later than <paramref name="latest"/>.</summary>
    internal static DateTimeOffset Nanoseconds(JsonElement element, DateTimeOffset latest)
    {
        var text = Json.Text(element, 20);
        if (!text.All(char.IsAsciiDigit) || !long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var ns))
            throw Json.Invalid();
        var at = DateTimeOffset.FromUnixTimeMilliseconds(ns / 1_000_000);
        return at > latest ? throw Json.Invalid() : at;
    }

    private static string Side(JsonElement element) => Json.Text(element, 8) switch
    {
        "BUY" => ExecutionFacts.Buy,
        "SELL" => ExecutionFacts.Sell,
        _ => throw Json.Invalid()
    };

    /// <summary>
    /// <c>position_side</c> is the side of the position a fill acts on. A different side reduces or closes it; the same
    /// side with closed PnL of exactly minus the fee opens or increases it. The same side with other PnL is probably a
    /// flip or settled funding and stays unknown until verified.
    /// </summary>
    internal static string Effect(string side, string positionSide, decimal realizedPnl, decimal fee) =>
        side != positionSide ? ExecutionFacts.Close
        : realizedPnl == -fee ? ExecutionFacts.Open
        : ExecutionFacts.Unknown;

    /// <summary>Display wording derived from side and effect, since RISEx sends no direction text.</summary>
    private static string Direction(string side, string positionSide, string effect, bool liquidation) =>
        (liquidation ? "Liquidation · " : "") + effect switch
        {
            ExecutionFacts.Open => side == ExecutionFacts.Buy ? "Open Long" : "Open Short",
            ExecutionFacts.Close => positionSide == ExecutionFacts.Buy ? "Close Long" : "Close Short",
            _ => side == ExecutionFacts.Buy ? "Buy" : "Sell"
        };

    internal static List<VenueFill> ReadFills(JsonElement data, RisexCatalogue catalogue, DateTimeOffset latest)
    {
        var trades = Json.Array(Json.Property(data, "trades"));
        if (trades.GetArrayLength() > PageSize) throw Json.Invalid();
        var fills = new List<VenueFill>();
        foreach (var trade in trades.EnumerateArray())
        {
            var marketId = Json.Text(Json.Property(trade, "market_id"), 20);
            if (catalogue.ById(marketId) is not { } market) continue;
            var side = Side(Json.Property(trade, "side"));
            var positionSide = Side(Json.Property(trade, "position_side"));
            var fee = Json.Nonnegative(Json.Property(trade, "fee"));
            var pnl = Json.Number(Json.Property(trade, "realized_pnl"));
            var effect = Effect(side, positionSide, pnl, fee);
            var liquidation = Json.Boolean(Json.Property(trade, "is_liquidation"));
            var chain = Json.Property(trade, "blockchain_data");
            fills.Add(new VenueFill(Json.Text(Json.Property(trade, "id")), market.Key, side,
                Direction(side, positionSide, effect, liquidation), Json.Positive(Json.Property(trade, "price")),
                Json.Positive(Json.Property(trade, "size")), fee, QuoteAsset, pnl, Nanoseconds(Json.Property(trade, "time"), latest),
                Json.Text(Json.Property(trade, "order_id")), Json.TextOrEmpty(Json.Property(chain, "tx_hash"), 256), trade.GetRawText(),
                effect, ExecutionFacts.FeeReported, ExecutionFacts.PnlNetOfFee, marketId));
        }
        return fills;
    }

    // ---- Orders ----

    public Task<VenueOrderReadResult> ReadOrdersAsync(string publicAddress, CancellationToken cancellationToken)
    {
        var address = Address(publicAddress);
        var latest = timeProvider.GetUtcNow().AddMinutes(5);
        return Http.ReadBoundedAsync(async token =>
        {
            var catalogue = await CatalogueAsync(token);
            using var history = await GetAsync($"/v1/orders?account={address}&limit={PageSize}&page=1", token);
            using var tpsl = await GetAsync($"/v1/orders/tpsl?account={address}&limit={PageSize}&page=1", token);
            var orders = ReadOrders(Data(history), catalogue, latest).Concat(ReadTpslOrders(Data(tpsl), catalogue, latest))
                .GroupBy(o => o.OrderId, StringComparer.Ordinal).Select(g => g.OrderByDescending(o => o.StatusAtUtc).First())
                .OrderByDescending(o => o.PlacedAtUtc).ToList();
            return new VenueOrderReadResult(orders, timeProvider.GetUtcNow(), OrdersNotice);
        }, cancellationToken);
    }

    internal static VenueOrderStatus Status(string status) => status switch
    {
        "ORDER_STATUS_OPEN" => VenueOrderStatus.Open,
        "ORDER_STATUS_FILLED" => VenueOrderStatus.Filled,
        "ORDER_STATUS_CANCELLED" => VenueOrderStatus.Canceled,
        "TPSL_ORDER_STATUS_ACCEPTED" => VenueOrderStatus.Open,
        "TPSL_ORDER_STATUS_TRIGGERED" => VenueOrderStatus.Triggered,
        "TPSL_ORDER_STATUS_SUCCESS" => VenueOrderStatus.Filled,
        "TPSL_ORDER_STATUS_CANCELLED" => VenueOrderStatus.Canceled,
        _ => VenueOrderStatus.Other
    };

    private static decimal OptionalDecimal(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } text
            ? Json.ParseDecimal(text) : 0m;

    private static DateTimeOffset? OptionalNanoseconds(JsonElement item, string name, DateTimeOffset latest) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } text && text != "0"
            ? Nanoseconds(value, latest) : null;

    internal static List<VenueOrder> ReadOrders(JsonElement data, RisexCatalogue catalogue, DateTimeOffset latest)
    {
        var items = Json.Array(Json.Property(data, "orders"));
        if (items.GetArrayLength() > PageSize) throw Json.Invalid();
        var orders = new List<VenueOrder>();
        foreach (var item in items.EnumerateArray())
        {
            var marketId = Json.Text(Json.Property(item, "market_id"), 20);
            if (catalogue.ById(marketId) is not { } market) continue;
            var size = Json.Nonnegative(Json.Property(item, "size"));
            var filled = Json.Nonnegative(Json.Property(item, "filled_size"));
            var stopType = Json.Text(Json.Property(item, "stop_type"), 32);
            var stop = OptionalDecimal(item, "stop_price");
            var raw = Json.Text(Json.Property(item, "status"), 64);
            var placed = Nanoseconds(Json.Property(item, "created_at"), latest);
            orders.Add(new VenueOrder(Json.Text(Json.Property(item, "id")), market.Key, Side(Json.Property(item, "side")),
                OrderType(Json.Text(Json.Property(item, "type"), 16), stopType),
                Json.Nonnegative(Json.Property(item, "price")), stopType != "STOP_TYPE_NONE" && stop > 0 ? stop : null,
                Json.Boolean(Json.Property(item, "reduce_only")), false, size, Math.Max(0, size - filled), placed,
                Status(raw), raw, OptionalNanoseconds(item, "cancel_requested_at", latest) ?? placed, marketId));
        }
        return orders;
    }

    /// <summary>
    /// TP/SL orders RISEx keeps off-chain until their stop price is met. A whole-position TP/SL has a share of
    /// 10,000 basis points and no size of its own.
    /// </summary>
    internal static List<VenueOrder> ReadTpslOrders(JsonElement data, RisexCatalogue catalogue, DateTimeOffset latest)
    {
        var items = Json.Array(Json.Property(data, "orders"));
        if (items.GetArrayLength() > PageSize) throw Json.Invalid();
        var orders = new List<VenueOrder>();
        foreach (var item in items.EnumerateArray())
        {
            var marketId = Json.Text(Json.Property(item, "market_id"), 20);
            if (catalogue.ById(marketId) is not { } market) continue;
            var stopType = Json.Text(Json.Property(item, "stop_type"), 32);
            var size = OptionalDecimal(item, "size");
            var filled = OptionalDecimal(item, "filled_size");
            var wholePosition = size == 0 && item.TryGetProperty("size_percent_bps", out var share) &&
                (share.ValueKind == JsonValueKind.Number ? share.GetRawText() : share.ValueKind == JsonValueKind.String ? share.GetString() : null) == "10000";
            var raw = Json.Text(Json.Property(item, "status"), 64);
            var placed = Nanoseconds(Json.Property(item, "created_at"), latest);
            orders.Add(new VenueOrder(Json.Text(Json.Property(item, "order_id")), market.Key, Side(Json.Property(item, "side")),
                stopType == "TAKE_PROFIT" ? "Take Profit Market" : "Stop Market", OptionalDecimal(item, "limit_price"),
                Json.Positive(Json.Property(item, "stop_price")), true, wholePosition, size, Math.Max(0, size - filled), placed,
                Status(raw), raw, OptionalNanoseconds(item, "triggered_at", latest) ?? placed, marketId));
        }
        return orders;
    }

    private static string OrderType(string type, string stopType) => (type, stopType) switch
    {
        (_, "STOP_LOSS") => type == "LIMIT" ? "Stop Limit" : "Stop Market",
        (_, "TAKE_PROFIT") => type == "LIMIT" ? "Take Profit Limit" : "Take Profit Market",
        ("LIMIT", _) => "Limit",
        ("MARKET", _) => "Market",
        _ => throw Json.Invalid()
    };

    // ---- Market data ----

    public Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(string contractId, string interval, long fromMs, long toMs, CancellationToken cancellationToken)
    {
        if (!IntervalMs.TryGetValue(interval, out var step) || fromMs < 0 || toMs < fromMs)
            throw new VenueReadException("A native RISEx interval and a valid window are required.");
        return Http.ReadBoundedAsync<IReadOnlyList<VenueCandle>>(async token =>
        {
            var market = (await CatalogueAsync(token)).ActiveByKey(contractId)
                ?? throw new VenueReadException("The instrument is not an active RISEx market.");
            using var document = await GetAsync(
                $"/v1/markets/id/{market.MarketId}/trading-view-data?interval={step * 1_000_000}&from={fromMs * 1_000_000}&to={toMs * 1_000_000}", token);
            return ReadCandles(Data(document), market.MarketId, interval, step);
        }, cancellationToken);
    }

    /// <summary>
    /// Rejects any row labelled with another interval: RISEx answers unsupported intervals with 1m candles. The open is
    /// the previous close and is not required to lie within the candle's own range.
    /// </summary>
    internal static List<VenueCandle> ReadCandles(JsonElement data, string marketId, string interval, long stepMs)
    {
        var rows = Json.Array(Json.Property(data, "data"));
        if (rows.GetArrayLength() > MaxCandles) throw Json.Invalid();
        var candles = new List<VenueCandle>();
        foreach (var row in rows.EnumerateArray())
        {
            if (Json.Text(Json.Property(row, "market_id"), 20) != marketId || Json.Text(Json.Property(row, "interval"), 8) != interval)
                throw Json.Invalid();
            var open = Price(row, "open"); var high = Price(row, "high"); var low = Price(row, "low"); var close = Price(row, "close");
            var volume = Price(row, "volume");
            // RISEx opens each candle at the previous close, so the open can lie a tick outside its own high and low
            // (26 of 501 hourly BTC candles on October 5). The values are kept as reported; only the close is checked.
            if (high.Value < low.Value || close.Value > high.Value || close.Value < low.Value)
                throw Json.Invalid();
            var openTime = Nanoseconds(Json.Property(row, "time"), DateTimeOffset.MaxValue).ToUnixTimeMilliseconds();
            candles.Add(new(openTime, openTime + stepMs - 1, open.Text, high.Text, low.Text, close.Text, volume.Text, null));
        }
        return candles;
    }

    private static (string Text, decimal Value) Price(JsonElement row, string name)
    {
        var text = Json.Text(Json.Property(row, name), 64);
        var value = Json.ParseDecimal(text);
        return value < 0 ? throw Json.Invalid() : (text, value);
    }

    public Task<IReadOnlyList<VenueMarketContext>> ReadMarketContextsAsync(CancellationToken cancellationToken) =>
        Http.ReadBoundedAsync<IReadOnlyList<VenueMarketContext>>(async token =>
        {
            // Read fresh: the catalogue cache holds structure, these are live statistics.
            using var document = await GetAsync("/v1/markets", token);
            var data = Data(document);
            var catalogue = ReadCatalogue(data);
            return ReadMarketContexts(data, catalogue);
        }, cancellationToken);

    internal static List<VenueMarketContext> ReadMarketContexts(JsonElement data, RisexCatalogue catalogue)
    {
        var contexts = new List<VenueMarketContext>();
        foreach (var item in Json.Array(Json.Property(data, "markets")).EnumerateArray())
        {
            if (catalogue.ById(Json.Text(Json.Property(item, "market_id"), 20)) is not { Active: true } market) continue;
            string Unsigned(string name) => Price(item, name).Text;
            var funding = Json.Text(Json.Property(item, "current_funding_rate"), 64);
            Json.ParseDecimal(funding);
            // RISEx reports a 24-hour change, not the previous price, and no mid or premium; those stay unknown.
            contexts.Add(new(market.Key, Unsigned("mark_price"), Unsigned("index_price"), null, null,
                Unsigned("quote_volume_24h"), Unsigned("open_interest"), funding, null));
        }
        return contexts;
    }
}

/// <summary>Short-lived catalogue cache shared by RISEx reads (register as a singleton). Market structure changes rarely.</summary>
public sealed class RisexCatalogueCache(TimeProvider time)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(1);
    private readonly SemaphoreSlim gate = new(1, 1);
    private (DateTimeOffset Expires, RisexReader.RisexCatalogue Value)? entry;

    internal async Task<RisexReader.RisexCatalogue> GetAsync(Func<CancellationToken, Task<RisexReader.RisexCatalogue>> load, CancellationToken ct)
    {
        if (entry is { } hit && hit.Expires > time.GetUtcNow()) return hit.Value;
        await gate.WaitAsync(ct);
        try
        {
            if (entry is { } again && again.Expires > time.GetUtcNow()) return again.Value;
            var value = await load(ct);
            entry = (time.GetUtcNow() + Lifetime, value);
            return value;
        }
        finally { gate.Release(); }
    }
}
