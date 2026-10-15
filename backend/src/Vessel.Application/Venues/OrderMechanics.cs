namespace Vessel.Application.Venues;

/// <summary>How an order acts, from the normalized order facts adapters report (trigger price and order type).</summary>
public enum OrderMechanism { Plain, Stop, TakeProfit, UnknownTrigger }

/// <summary>
/// The single classification of stop and take-profit orders for matching, link validation and monitoring. Adapters
/// report order types such as <c>Stop Market</c>, <c>Take Profit Limit</c> or <c>stop-loss</c>; the words decide, never
/// the venue. A trigger order whose type names neither is <see cref="OrderMechanism.UnknownTrigger"/> and never
/// establishes stop protection.
/// </summary>
public static class OrderMechanics
{
    public static OrderMechanism Classify(string orderType, bool hasTrigger)
    {
        if (!hasTrigger) return OrderMechanism.Plain;
        var words = orderType.ToLowerInvariant().Replace('-', ' ').Replace('_', ' ');
        return words.Contains("take profit") ? OrderMechanism.TakeProfit
            : words.Contains("stop") ? OrderMechanism.Stop
            : OrderMechanism.UnknownTrigger;
    }

    public static OrderMechanism Classify(VenueOrder order) => Classify(order.OrderType, order.TriggerPrice is not null);
}
