using System.Net;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Venues;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Risex;

namespace Vessel.Tests;

/// <summary>RISEx adapter against recorded response shapes (October 5, 2026). The address is synthetic.</summary>
public sealed class RisexAdapterTests
{
    private const string Address = "0x00000000000000000000000000000000000000aa";
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-05T12:00:00Z");
    private static string Ns(DateTimeOffset at) => (at.ToUnixTimeMilliseconds() * 1_000_000).ToString();

    private static string Market(string id, string name, bool active = true, string category = "crypto", string tick = "0.1",
        string step = "0.000001", string leverage = "25", bool unlocked = true) => $$"""
        {"market_id":"{{id}}","config":{"name":"{{name}}","quote":"0xe4","step_size":"{{step}}","step_price":"{{tick}}",
         "maintenance_margin_factor":"37.5","max_leverage":"{{leverage}}","min_order_size":"0.00015","unlocked":{{(unlocked ? "true" : "false")}},"open_interest_limit":"750"},
         "base_asset_symbol":"{{name}}","quote_asset_symbol":"USDC","display_name":"{{name}}","quote_volume_24h":"35255149.8695194",
         "change_24h":"1476.4","last_price":"86650.9","mark_price":"86627.713809202553651873","index_price":"86659.469794009055",
         "open_interest":"187.059842","funding_interval":"3600000000000","current_funding_rate":"0.000004298138961497",
         "active":{{(active ? "true" : "false")}},"category":"{{category}}"}
        """;

    private static readonly string Markets = $$"""
        {"data":{"markets":[{{Market("1", "BTC/USDC")}},
          {{Market("13", "DOGE/USDC [deprecated-1779958099]", active: false, category: "", tick: "0.0001", step: "0.01", leverage: "10")}},
          {{Market("14", "DOGE/USDC", tick: "0.00001", step: "0.01", leverage: "10")}},
          {{Market("40", "TSLA/USDC", category: "stocks", tick: "0.01", step: "0.001", leverage: "5")}},
          {{Market("50", "weird name", category: "crypto")}}],"cached_at":"0"},"request_id":"r"}
        """;

    private static string Portfolio => """
        {"data":{"account":"0x00000000000000000000000000000000000000aa","summary":{"collateral_margin_balance":"11853.7","cross_margin_balance":"12183.26",
          "free_collateral":"131.89","total_account_value":"12183.268781664941504325","usdc_balance":"11853.7","total_unrealized_pnl":"146.14",
          "total_initial_margin":"12051.377019174158945586","total_maintenance_margin":"3213.7","realized_pnl":"-1987.9","unsettled_usdc":"352.98",
          "in_liquidation":false,"risk_level":"NORMAL"},
          "positions":[
            {"size":"0","quote_amount":"","margin_mode":0,"side":0,"market_id":"40","market_name":"TSLA/USDC","avg_entry_price":"0","mark_price":"300",
             "leverage":"0","unrealized_pnl":"0","liquidation_price":"0","initial_margin_requirement":"0"},
            {"size":"0.702475","quote_amount":"","margin_mode":0,"side":0,"market_id":"1","market_name":"BTC/USDC","avg_entry_price":"84927.632925174710359523",
             "mark_price":"86001.3","leverage":"10","unrealized_pnl":"754.238926063737700192","liquidation_price":"73336.01",
             "initial_margin_requirement":"6041.377786517584236"},
            {"size":"-2000","quote_amount":"","margin_mode":0,"side":0,"market_id":"14","market_name":"DOGE/USDC","avg_entry_price":"0.0951",
             "mark_price":"0.0946","leverage":"5","unrealized_pnl":"1","liquidation_price":"0.11","initial_margin_requirement":"38"}]},"request_id":"r"}
        """;

    private static string Trade(string id, string market, string side, string positionSide, string fee, string pnl, DateTimeOffset at,
        string order = "0xorder1", bool liquidation = false) => $$"""
        {"id":"{{id}}","market_id":"{{market}}","order_id":"{{order}}","side":"{{side}}","price":"86000.5","size":"0.01","fee":"{{fee}}",
         "liquidity_indicator":"MAKER","time":"{{Ns(at)}}","blockchain_data":{"block_number":"1","tx_hash":"0xhash{{id}}","log_index":"1"},
         "is_liquidation":{{(liquidation ? "true" : "false")}},"realized_pnl":"{{pnl}}","leverage":"10","margin_mode":0,"realized_pnl_percentage":"0",
         "avg_price":"86000","position_side":"{{positionSide}}","is_otc":false,"client_order_id":""}
        """;

    private static readonly string Trades = $$"""
        {"data":{"market_id":"0","wallet_address":"{{Address}}","trades":[
          {{Trade("0xopen", "1", "BUY", "BUY", "0.086", "-0.086", Now.AddMinutes(-30))}},
          {{Trade("0xclose", "1", "SELL", "BUY", "0.086", "12.5", Now.AddMinutes(-10), "0xorder2")}},
          {{Trade("0xflip", "14", "SELL", "SELL", "0.01", "3.2", Now.AddMinutes(-5), "0xorder3")}},
          {{Trade("0xretired", "13", "BUY", "BUY", "0.01", "-0.01", Now.AddDays(-200), "0xorder4")}},
          {{Trade("0xunknown", "999", "BUY", "BUY", "0.01", "-0.01", Now.AddMinutes(-1), "0xorder5")}}],"page":1,"has_next_page":false},"request_id":"r"}
        """;

    private static readonly string Orders = $$"""
        {"data":{"orders":[
          {"id":"0xorder1","price":"86000.5","size":"0.01","market_id":"1","side":"BUY","type":"LIMIT","time_in_force":"GTC","expiry":"0",
           "post_only":false,"reduce_only":false,"cancel_reason":"","filled_size":"0.01","status":"ORDER_STATUS_FILLED","fee_bps":"300",
           "avg_price":"86000.5","cancel_requested":false,"created_at":"{{Ns(Now.AddMinutes(-31))}}","cancel_requested_at":"0",
           "stop_type":"STOP_TYPE_NONE","stop_price":"","stop_price_option":"PRICE_OPTION_NONE","is_liquidation":false},
          {"id":"0xorder9","price":"90000","size":"0.01","market_id":"1","side":"SELL","type":"LIMIT","time_in_force":"GTC","expiry":"0",
           "post_only":false,"reduce_only":true,"cancel_reason":"","filled_size":"0","status":"ORDER_STATUS_OPEN","fee_bps":"300",
           "avg_price":"0","cancel_requested":false,"created_at":"{{Ns(Now.AddMinutes(-20))}}","cancel_requested_at":"0",
           "stop_type":"STOP_TYPE_NONE","stop_price":"","stop_price_option":"PRICE_OPTION_NONE","is_liquidation":false}],
          "page":1,"has_next_page":false},"request_id":"r"}
        """;

    private static readonly string Tpsl = $$"""
        {"data":{"orders":[
          {"order_id":"0xtpsl1","account":"{{Address}}","market_id":"1","side":"SELL","size":"0","size_percent_bps":10000,
           "stop_type":"STOP_LOSS","stop_price":"80000","limit_price":"","order_type":"MARKET","status":"TPSL_ORDER_STATUS_ACCEPTED",
           "created_at":"{{Ns(Now.AddMinutes(-15))}}","triggered_at":"0","tif":"GTC"}],"total":"1","page":1,"limit":1000},"request_id":"r"}
        """;

    private sealed class Routes(Dictionary<string, string> bodies) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.Method + " " + request.RequestUri!.PathAndQuery);
            var path = request.RequestUri.AbsolutePath;
            var body = bodies.TryGetValue(path, out var found) ? found : "{}";
            return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static (RisexReader Reader, Routes Routes) Reader(Dictionary<string, string>? extra = null)
    {
        var bodies = new Dictionary<string, string>
        {
            ["/v1/markets"] = Markets, ["/v1/portfolio/details"] = Portfolio, ["/v1/trade-history"] = Trades,
            ["/v1/orders"] = Orders, ["/v1/orders/tpsl"] = Tpsl,
        };
        foreach (var (path, body) in extra ?? []) bodies[path] = body;
        var routes = new Routes(bodies);
        var time = new FixedTime(Now);
        return (new RisexReader(new HttpClient(routes) { BaseAddress = new Uri("https://api.rise.trade/") }, time, new RisexCatalogueCache(time)), routes);
    }

    [Fact]
    public async Task Catalogue_maps_markets_to_assets_with_ticks_categories_and_market_ids_and_hides_retired_ones()
    {
        var instruments = await Reader().Reader.ReadInstrumentsAsync(default);
        Assert.Equal(["BTC", "DOGE", "TSLA"], instruments.Select(i => i.ContractId));
        var btc = instruments[0];
        Assert.Equal((6, 25, "USDC", 0.1m, "crypto", "1"), (btc.QuantityDecimals, btc.MaxLeverage, btc.QuoteAsset, btc.PriceStep, btc.Category, btc.VenueContractId));
        var doge = instruments[1];
        Assert.Equal((0.00001m, "14", 2), (doge.PriceStep, doge.VenueContractId, doge.QuantityDecimals));
        Assert.Equal("stocks", instruments[2].Category);
    }

    [Fact]
    public async Task Two_active_markets_for_one_asset_are_refused_rather_than_guessed()
    {
        var duplicate = $$"""{"data":{"markets":[{{Market("1", "BTC/USDC")}},{{Market("2", "BTC/USDC")}}]},"request_id":"r"}""";
        var error = await Assert.ThrowsAsync<VenueReadException>(() => Reader(new() { ["/v1/markets"] = duplicate }).Reader.ReadInstrumentsAsync(default));
        Assert.Equal("RISEx returned an invalid or unsupported response.", error.Message);
    }

    [Fact]
    public async Task Refresh_reads_signed_positions_equity_and_fills_in_vessels_vocabulary()
    {
        var (reader, routes) = Reader();
        var result = await reader.ReadAsync(Address.ToUpperInvariant().Replace("0X", "0x"), default);
        Assert.Contains($"GET /v1/portfolio/details?account={Address}", routes.Requests);
        Assert.Contains($"GET /v1/trade-history?account={Address}&limit=1000&page=1", routes.Requests);
        Assert.All(routes.Requests, request => Assert.StartsWith("GET ", request));

        var snapshot = result.Snapshot;
        Assert.Equal(12183.268781664941504325m, snapshot.AccountValueUsd);
        Assert.Null(snapshot.WithdrawableUsd);
        Assert.Equal(12051.377019174158945586m, snapshot.MarginUsedUsd);
        Assert.Null(snapshot.StablecoinWallet);
        Assert.Equal([("BTC", 0.702475m, 10), ("DOGE", -2000m, 5)], snapshot.Positions.Select(p => (p.ContractId, p.SignedQuantity, p.Leverage!.Value)));

        var fills = result.Fills.ToDictionary(f => f.SourceFillId);
        Assert.Equal(4, fills.Count); // the unknown market is left out
        Assert.All(fills.Values, f => Assert.True(VenueFactChecks.Valid(f)));
        Assert.Equal((ExecutionFacts.Buy, ExecutionFacts.Open, "Open Long", "1"), (fills["0xopen"].Side, fills["0xopen"].PositionEffect, fills["0xopen"].Direction, fills["0xopen"].VenueContractId));
        Assert.Equal((ExecutionFacts.Sell, ExecutionFacts.Close, "Close Long", 12.5m), (fills["0xclose"].Side, fills["0xclose"].PositionEffect, fills["0xclose"].Direction, fills["0xclose"].ClosedPnlUsd));
        // Same side as the position with PnL beyond the fee: probably a flip, not verified, so unknown.
        Assert.Equal((ExecutionFacts.Unknown, "Sell"), (fills["0xflip"].PositionEffect, fills["0xflip"].Direction));
        Assert.Equal(("DOGE", "13"), (fills["0xretired"].ContractId, fills["0xretired"].VenueContractId));
        Assert.All(fills.Values, f => Assert.Equal((ExecutionFacts.PnlNetOfFee, ExecutionFacts.FeeReported, "USDC"), (f.PnlBasis, f.FeeBasis, f.FeeToken)));
        Assert.Equal(Now.AddMinutes(-30), fills["0xopen"].OccurredAtUtc);
        Assert.Equal("0xhash0xopen", fills["0xopen"].TransactionHash);
        Assert.Contains("net of fees", result.HistoryNotice);
    }

    [Fact]
    public async Task Orders_include_tpsl_records_as_trigger_orders()
    {
        var read = await Reader().Reader.ReadOrdersAsync(Address, default);
        var orders = read.Orders.ToDictionary(o => o.OrderId);
        Assert.All(orders.Values, o => Assert.True(VenueFactChecks.Valid(o)));
        Assert.Equal((VenueOrderStatus.Filled, "Limit", 0m, (decimal?)null), (orders["0xorder1"].Status, orders["0xorder1"].OrderType, orders["0xorder1"].RemainingSize, orders["0xorder1"].TriggerPrice));
        Assert.Equal((VenueOrderStatus.Open, true, ExecutionFacts.Sell), (orders["0xorder9"].Status, orders["0xorder9"].ReduceOnly, orders["0xorder9"].Side));
        var stop = orders["0xtpsl1"];
        Assert.Equal((VenueOrderStatus.Open, "Stop Market", 80000m, true, true), (stop.Status, stop.OrderType, stop.TriggerPrice, stop.ReduceOnly, stop.IsPositionTpsl));
        Assert.Equal("1", stop.VenueContractId);
    }

    [Fact]
    public async Task Candles_use_market_id_nanoseconds_and_refuse_a_fallback_interval()
    {
        var start = Now.AddHours(-2);
        string Row(string interval, DateTimeOffset at) =>
            $$"""{"market_id":"14","interval":"{{interval}}","time":"{{Ns(at)}}","low":"0.0940","high":"0.0950","open":"0.0945","close":"0.0948","volume":"1000"}""";
        // The second row opens at the previous close, above its own high, as RISEx reports it.
        var carried = $$"""{"market_id":"14","interval":"1h","time":"{{Ns(start.AddHours(1))}}","low":"0.0940","high":"0.0947","open":"0.0948","close":"0.0941","volume":"5"}""";
        var good = $$"""{"data":{"data":[{{Row("1h", start)}},{{carried}}]},"request_id":"r"}""";
        var (reader, routes) = Reader(new() { ["/v1/markets/id/14/trading-view-data"] = good });
        var candles = await reader.ReadCandlesAsync("DOGE", "1h", start.ToUnixTimeMilliseconds(), Now.ToUnixTimeMilliseconds(), default);
        Assert.Equal(2, candles.Count);
        Assert.Equal((start.ToUnixTimeMilliseconds(), start.ToUnixTimeMilliseconds() + 3_599_999, "0.0945", (int?)null),
            (candles[0].OpenTime, candles[0].CloseTime, candles[0].Open, candles[0].Trades));
        Assert.Contains(routes.Requests, r => r.Contains($"/v1/markets/id/14/trading-view-data?interval=3600000000000&from={start.ToUnixTimeMilliseconds() * 1_000_000}"));

        // RISEx answers an unsupported interval with 1m rows; a mislabelled row is never accepted.
        var fallback = $$"""{"data":{"data":[{{Row("1m", start)}}]},"request_id":"r"}""";
        await Assert.ThrowsAsync<VenueReadException>(() => Reader(new() { ["/v1/markets/id/14/trading-view-data"] = fallback }).Reader
            .ReadCandlesAsync("DOGE", "1h", start.ToUnixTimeMilliseconds(), Now.ToUnixTimeMilliseconds(), default));
        Assert.Equal("0.0948", candles[1].Open);
        var broken = $$"""{"data":{"data":[{"market_id":"14","interval":"1h","time":"{{Ns(start)}}","low":"0.0940","high":"0.0947","open":"0.0945","close":"0.0950","volume":"5"}]},"request_id":"r"}""";
        await Assert.ThrowsAsync<VenueReadException>(() => Reader(new() { ["/v1/markets/id/14/trading-view-data"] = broken }).Reader
            .ReadCandlesAsync("DOGE", "1h", start.ToUnixTimeMilliseconds(), Now.ToUnixTimeMilliseconds(), default));
        await Assert.ThrowsAsync<VenueReadException>(() => reader.ReadCandlesAsync("DOGE", "3m", 0, 1, default));
        await Assert.ThrowsAsync<VenueReadException>(() => reader.ReadCandlesAsync("NOPE", "1h", 0, 1, default));
    }

    [Fact]
    public async Task Market_context_keeps_exact_strings_and_leaves_unreported_fields_unknown()
    {
        var contexts = await Reader().Reader.ReadMarketContextsAsync(default);
        var btc = contexts.Single(c => c.ContractId == "BTC");
        Assert.Equal(("86627.713809202553651873", "86659.469794009055", "35255149.8695194", "187.059842", "0.000004298138961497"),
            (btc.MarkPrice, btc.OraclePrice, btc.DayNotionalVolume, btc.OpenInterest, btc.FundingRate));
        Assert.Null(btc.PreviousDayPrice);
        Assert.Null(btc.MidPrice);
        Assert.DoesNotContain(contexts, c => c.ContractId == "weird name");
        Assert.Equal(3, contexts.Count);
    }

    [Fact]
    public async Task Failures_are_safe_messages()
    {
        var (reader, routes) = Reader();
        routes.Status = HttpStatusCode.Forbidden;
        var error = await Assert.ThrowsAsync<VenueReadException>(() => reader.ReadAsync(Address, default));
        Assert.Equal("RISEx is unavailable. Try again later.", error.Message);
        await Assert.ThrowsAsync<VenueReadException>(() => reader.ReadAsync("0x12", default));
        var bad = Reader(new() { ["/v1/portfolio/details"] = """{"data":{"summary":{},"positions":[]},"request_id":"r"}""" }).Reader;
        Assert.Equal("RISEx returned an invalid or unsupported response.", (await Assert.ThrowsAsync<VenueReadException>(() => bad.ReadAsync(Address, default))).Message);
    }

    [Fact]
    public async Task Each_venue_keeps_its_own_http_client_configuration()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        var clients = factory.Services.GetRequiredService<IHttpClientFactory>();
        Assert.Equal("https://api.rise.trade/", clients.CreateClient("risex-IPerpetualVenueReader").BaseAddress!.AbsoluteUri);
        Assert.Equal("https://api.hyperliquid.xyz/", clients.CreateClient(nameof(IPerpetualVenueReader)).BaseAddress!.AbsoluteUri);
        Assert.Contains("Vessel", clients.CreateClient("risex-ICandleReader").DefaultRequestHeaders.UserAgent.ToString());
        using var scope = factory.Services.CreateScope();
        var venues = scope.ServiceProvider.GetRequiredService<IVenueRegistry>();
        Assert.Equal("RISEx", venues.Descriptor("risex")!.Name);
        Assert.Equal(["hyperliquid", "risex"], new[] { "hyperliquid", "risex" }.Where(id => venues.Reader(id)?.VenueId == id));
        Assert.Equal("risex", venues.Orders("risex")!.VenueId);
        Assert.Null(venues.Stream("risex"));
    }
}
