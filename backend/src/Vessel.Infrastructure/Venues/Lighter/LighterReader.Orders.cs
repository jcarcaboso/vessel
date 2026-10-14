using System.Globalization;
using System.Text.Json;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Venues.Common;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Infrastructure.Venues.Lighter;

public sealed partial class LighterReader
{
    // Mainnet wording for existing callers; each exchange words its own.
    internal static string OrdersNotice => LighterExchange.Mainnet.OrdersNotice;
    internal const string OrdersPageLimitNotice = " The five-page history limit was reached.";

    public Task<VenueOrderReadResult> ReadOrdersAsync(string sourceId, CancellationToken cancellationToken)
    {
        Index(sourceId, venue);
        throw new VenueReadException(venue.TokenRequired);
    }

    public async Task<VenueOrderReadResult> ReadOrdersAsync(Account account, CancellationToken cancellationToken)
    {
        var source = Source(account);
        var credential = await credentials.ReadAsync(account.Id, cancellationToken)
            ?? throw new VenueReadException(venue.TokenRequired);
        return await BoundedAsync(async ct =>
        {
            await BindAsync(source, credential, ct);
            var catalogue = await CatalogueAsync(ct, refresh: true);
            var observed = timeProvider.GetUtcNow();
            var orders = new Dictionary<string, VenueOrder>(StringComparer.Ordinal);
            using (var active = await GetAsync("accountActiveOrders?account_index=" + source + "&market_type=perp", ct, credential))
                foreach (var order in ReadOrders(active.RootElement, catalogue, source, observed, 1000))
                    if (!orders.TryAdd(order.OrderId, order)) throw json.Invalid();
            string? cursor = null;
            var cursors = new HashSet<string>(StringComparer.Ordinal);
            for (var page = 0; page < MaxPages; page++)
            {
                using var inactive = await GetAsync("accountInactiveOrders?account_index=" + source + "&market_type=perp&limit=100" +
                    (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor)), ct, credential);
                foreach (var order in ReadOrders(inactive.RootElement, catalogue, source, observed, PageSize))
                    // A fill/cancel can move an order between the two reads. Keep the later observation.
                    if (!orders.TryGetValue(order.OrderId, out var previous) || order.StatusAtUtc >= previous.StatusAtUtc)
                        orders[order.OrderId] = order;
                cursor = Cursor(json, inactive.RootElement);
                if (cursor is null) break;
                if (!cursors.Add(cursor)) throw json.Invalid();
            }
            return new VenueOrderReadResult(orders.Values.ToArray(), observed, venue.OrdersNotice +
                (cursor is null ? "" : OrdersPageLimitNotice));
        }, cancellationToken);
    }

    private static DateTimeOffset Seconds(StrictJson json, JsonElement row, string name, DateTimeOffset latest)
    {
        var value = json.Property(row, name);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var seconds) ||
            seconds < 0 || seconds > latest.ToUnixTimeSeconds()) throw json.Invalid();
        return DateTimeOffset.FromUnixTimeSeconds(seconds);
    }

    // https://apidocs.lighter.xyz/reference/accountactiveorders.md and /reference/accountinactiveorders.md.
    // Authenticated happy-path payloads remain fixture-tested until the owner supplies a read-only token.
    internal static IReadOnlyList<VenueOrder> ReadOrders(JsonElement root, Catalogue catalogue, string source,
        DateTimeOffset observed, int limit)
    {
        var json = catalogue.Exchange.Json;
        var orders = new List<VenueOrder>();
        foreach (var row in Rows(json, root, "orders", limit).EnumerateArray())
        {
            if (Identity(json, json.Property(row, "owner_account_index")) != source) throw json.Invalid();
            var marketId = Identity(json, json.Property(row, "market_index"));
            if (catalogue.SpotIds.Contains(marketId)) continue;
            var market = catalogue.ById(marketId) ?? throw json.Invalid();
            var type = Text(json, row, "type");
            if (type is not ("limit" or "market" or "stop-loss" or "stop-loss-limit" or "take-profit" or
                "take-profit-limit" or "twap" or "twap-sub" or "liquidation")) throw json.Invalid();
            var initial = Nonnegative(json, row, "initial_base_amount");
            var remaining = Nonnegative(json, row, "remaining_base_amount");
            if (remaining > initial) throw json.Invalid();
            if (initial == 0 || type is "twap" or "twap-sub" ||
                (row.TryGetProperty("order_flags", out var flags) && json.Integer(flags) != 0)) continue;
            var id = ExactId(json, row, "order_index", "order_id");
            var isAsk = json.Boolean(json.Property(row, "is_ask"));
            var reduceOnly = json.Boolean(json.Property(row, "reduce_only"));
            var trigger = type.StartsWith("stop-loss", StringComparison.Ordinal) || type.StartsWith("take-profit", StringComparison.Ordinal);
            var price = Nonnegative(json, row, "price");
            var triggerPrice = Nonnegative(json, row, "trigger_price");
            if (trigger && triggerPrice == 0 || !trigger && triggerPrice != 0) throw json.Invalid();
            var status = Text(json, row, "status");
            if (status.Any(c => c is not (>= 'a' and <= 'z') && c != '-')) throw json.Invalid();
            var normalized = status switch
            {
                "open" or "in-progress" or "pending" => VenueOrderStatus.Open,
                "filled" => VenueOrderStatus.Filled,
                "canceled" => VenueOrderStatus.Canceled,
                _ when status.StartsWith("canceled-", StringComparison.Ordinal) => VenueOrderStatus.Canceled,
                _ => VenueOrderStatus.Other
            };
            var at = Seconds(json, row, "timestamp", observed.AddMinutes(5));
            // created_at/updated_at units have no official description. Do not guess based on magnitude.
            // timestamp is the venue order time; the local observation is a known upper bound for status time.
            orders.Add(new(id, market.Key, isAsk ? ExecutionFacts.Sell : ExecutionFacts.Buy, type,
                price, trigger ? triggerPrice : null, reduceOnly, false, initial, remaining, at,
                normalized, status, observed, marketId));
        }
        return orders;
    }
}
