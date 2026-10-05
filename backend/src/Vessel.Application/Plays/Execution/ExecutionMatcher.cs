using System.Globalization;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Plays.Execution;

/// <summary>A plan level an order could belong to, with the price and side it implies.</summary>
public sealed record PlanLevelTarget(OrderLinkRole Role, string? EntryId, string? LevelId, decimal? Price, string Side)
{
    public string Key => PlayOrderLink.Key(Role, EntryId, LevelId);
}

public sealed record MatchCandidate(Play Play, PlanLevelTarget Level);

/// <summary>
/// Decides which plan levels an order could belong to. Automatic linking needs exactly one candidate;
/// several are suggestions for the owner. A price touch is never involved: only venue orders are matched.
/// </summary>
public static class ExecutionMatcher
{

    public static bool IsActive(Play play) => play.Status is PlayStatus.Planned or PlayStatus.Paused or PlayStatus.Open;

    /// <summary>
    /// Entries, stops and targets with prices resolved. A percent level is a return on margin, so its price
    /// distance from the entry is the percentage divided by the plan's leverage.
    /// </summary>
    public static IEnumerable<PlanLevelTarget> Levels(PlayPlanDocument plan)
    {
        var long_ = plan.Direction == "long";
        var leverage = int.TryParse(plan.Leverage, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value >= 1 ? value : 1;
        string entrySide = long_ ? ExecutionFacts.Buy : ExecutionFacts.Sell, exitSide = long_ ? ExecutionFacts.Sell : ExecutionFacts.Buy;
        foreach (var entry in plan.Entries)
        {
            var price = Positive(entry.Price);
            yield return new(OrderLinkRole.Entry, entry.Id, null, price, entrySide);
            foreach (var stop in entry.Stops)
                yield return new(OrderLinkRole.Stop, entry.Id, stop.Id, Resolve(price, stop, leverage, below: long_), exitSide);
            foreach (var target in entry.Targets)
                yield return new(OrderLinkRole.Target, entry.Id, target.Id, Resolve(price, target, leverage, below: !long_), exitSide);
        }
    }

    public static string ExitSide(PlayPlanDocument plan) => plan.Direction == "long" ? ExecutionFacts.Sell : ExecutionFacts.Buy;

    /// <summary>
    /// Candidates for one order. Planned levels win over an unplanned exit, which is only proposed for an
    /// open Play when the order reduces a position and was placed after the Play's first entry fill.
    /// </summary>
    public static List<MatchCandidate> Candidates(ImportedOrder order, IEnumerable<(Play Play, PlayPlanDocument Plan)> plays,
        Func<Play, string, bool> dismissed, bool closesPosition, Func<Play, DateTimeOffset?>? firstEntryFill = null)
    {
        var planned = new List<MatchCandidate>();
        var exits = new List<MatchCandidate>();
        foreach (var (play, plan) in plays)
        {
            if (!IsActive(play) || play.InstrumentSource != InstrumentSource.Venue || play.ContractId != order.ContractId ||
                order.PlacedAtUtc < play.CreatedAtUtc)
                continue;
            var acting = order.TriggerPrice ?? order.LimitPrice;
            var kind = order.OrderType.ToLowerInvariant();
            foreach (var level in Levels(plan))
            {
                if (level.Side != order.Side || level.Price is not { } price || !Near(acting, price) || dismissed(play, level.Key)) continue;
                var fits = level.Role switch
                {
                    OrderLinkRole.Entry => !order.ReduceOnly && !order.IsPositionTpsl,
                    // A stop acts through a trigger; a resting limit at the stop would fill at once.
                    OrderLinkRole.Stop => order.TriggerPrice is not null && !kind.Contains("take profit"),
                    OrderLinkRole.Target => !kind.Contains("stop"),
                    _ => false
                };
                if (fits) planned.Add(new(play, level));
            }
            var exit = new PlanLevelTarget(OrderLinkRole.Exit, null, null, null, ExitSide(plan));
            if (play.Status == PlayStatus.Open && order.Side == exit.Side && (order.ReduceOnly || order.IsPositionTpsl || closesPosition) &&
                firstEntryFill?.Invoke(play) is { } opened && order.PlacedAtUtc >= opened && !dismissed(play, exit.Key))
                exits.Add(new(play, exit));
        }
        if (planned.Count > 0) return planned;
        return exits;
    }

    /// <summary>
    /// Same price within one step of the fifth significant figure, the precision Hyperliquid accepts for prices:
    /// 1 at 84,541, 0.01 at 100. A planned 82,850.18 from a percentage still matches an order at 82,850.
    /// </summary>
    public static bool Near(decimal actual, decimal planned)
    {
        if (planned <= 0) return false;
        var magnitude = (int)Math.Floor(Math.Log10((double)planned));
        var step = magnitude >= 4 ? Pow10(magnitude - 4) : 1m / Pow10(4 - magnitude);
        return Math.Abs(actual - planned) <= step;
    }

    private static decimal Pow10(int exponent)
    {
        var value = 1m;
        for (var i = 0; i < exponent; i++) value *= 10;
        return value;
    }

    private static decimal? Resolve(decimal? entry, PlanExit exit, int leverage, bool below)
    {
        if (exit.Unit == "price") return Positive(exit.Value);
        if (entry is not { } price || !TryDecimal(exit.Value, out var percent) || percent < 0) return null;
        var distance = percent / leverage;
        var resolved = price * (1 + (below ? -distance : distance) / 100);
        return resolved > 0 ? resolved : null;
    }

    private static decimal? Positive(string text) => TryDecimal(text, out var value) && value > 0 ? value : null;

    private static bool TryDecimal(string text, out decimal value) =>
        decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
}
