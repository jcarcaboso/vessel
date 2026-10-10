using System.Text.Json;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

// frontendOpenOrders is the current book; historicalOrders holds the latest 2,000 status updates,
// several per order. Shapes observed live on October 3, 2026.
public sealed partial class HyperliquidPerpetualReader : IVenueOrderReader
{
    private const int MaxOrders = 2000;
    private const string OrdersNotice =
        "Primary perpetual orders only. Order history is the latest 2,000 status updates; older orders are not available.";

    public Task<VenueOrderReadResult> ReadOrdersAsync(string publicAddress, CancellationToken cancellationToken)
    {
        EvmAddress.Require(publicAddress);
        var latestTimestamp = Math.Min(253402300799999L, timeProvider.GetUtcNow().ToUnixTimeMilliseconds() + 300000);
        return ReadBoundedAsync(async token =>
        {
            using var meta = await ReadJsonAsync(new { type = "meta", dex = "" }, token);
            var contracts = ReadInstruments(meta.RootElement).Select(i => i.VenueContractId ?? i.ContractId)
                .ToHashSet(StringComparer.Ordinal);
            using var history = await ReadJsonAsync(new { type = "historicalOrders", user = publicAddress }, token);
            using var open = await ReadJsonAsync(new { type = "frontendOpenOrders", user = publicAddress, dex = "" }, token);
            var orders = new Dictionary<string, VenueOrder>(StringComparer.Ordinal);
            var updates = Array(history.RootElement);
            if (updates.GetArrayLength() > MaxOrders) throw new VenueReadException(InvalidResponse);
            foreach (var update in updates.EnumerateArray())
            {
                var raw = Text(Property(update, "status"), 64);
                var order = ReadOrder(Property(update, "order"), contracts, latestTimestamp, raw, Normalize(raw),
                    Timestamp(Property(update, "statusTimestamp"), latestTimestamp));
                if (order is not null && (!orders.TryGetValue(order.OrderId, out var known) || order.StatusAtUtc >= known.StatusAtUtc))
                    orders[order.OrderId] = order;
            }
            var book = Array(open.RootElement);
            if (book.GetArrayLength() > MaxOrders) throw new VenueReadException(InvalidResponse);
            var observed = timeProvider.GetUtcNow();
            foreach (var item in book.EnumerateArray())
            {
                // The open book is the current truth and overrides an older history entry.
                var order = ReadOrder(item, contracts, latestTimestamp, "open", VenueOrderStatus.Open, observed);
                if (order is not null) orders[order.OrderId] = order;
            }
            return new VenueOrderReadResult(orders.Values.OrderByDescending(o => o.PlacedAtUtc).ToList(), observed, OrdersNotice);
        }, cancellationToken);
    }

    private static VenueOrder? ReadOrder(JsonElement order, HashSet<string> contracts, long latestTimestamp,
        string venueStatus, VenueOrderStatus status, DateTimeOffset statusAt)
    {
        var coin = Text(Property(order, "coin"));
        if (!contracts.Contains(coin)) return null;
        var side = Text(Property(order, "side"));
        if (side is not ("A" or "B")) throw new VenueReadException(InvalidResponse);
        var isTrigger = Property(order, "isTrigger");
        if (isTrigger.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new VenueReadException(InvalidResponse);
        var trigger = isTrigger.GetBoolean() ? Positive(Property(order, "triggerPx")) : (decimal?)null;
        return new VenueOrder(Identity(Property(order, "oid")), HyperliquidInstruments.Canonical(coin), SideOf(side), Text(Property(order, "orderType"), 32),
            Nonnegative(Property(order, "limitPx")), trigger, Flag(order, "reduceOnly"), Flag(order, "isPositionTpsl"),
            Nonnegative(Property(order, "origSz")), Nonnegative(Property(order, "sz")),
            Timestamp(Property(order, "timestamp"), latestTimestamp), status, venueStatus, statusAt,
            VenueContractId: HyperliquidInstruments.Canonical(coin) == coin ? null : coin);
    }

    private static bool Flag(JsonElement order, string name) =>
        order.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    public static VenueOrderStatus Normalize(string status) => status switch
    {
        "open" => VenueOrderStatus.Open,
        "filled" => VenueOrderStatus.Filled,
        "triggered" => VenueOrderStatus.Triggered,
        "canceled" or "scheduledCancel" => VenueOrderStatus.Canceled,
        _ when status.EndsWith("Canceled", StringComparison.Ordinal) => VenueOrderStatus.Canceled,
        "rejected" => VenueOrderStatus.Rejected,
        _ when status.EndsWith("Rejected", StringComparison.Ordinal) => VenueOrderStatus.Rejected,
        _ => VenueOrderStatus.Other
    };
}
