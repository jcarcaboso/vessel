using System.Globalization;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Sizing;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Plays;

/// <summary>Shared executed result and initial planned risk. Reporting applies its own eligibility and time window.</summary>
public static class PlayOutcomeCalculator
{
    private const string FeeToken = "USDC";
    /// <summary>
    /// Net result and planned risk of one closed Play. Risk uses the plan in force at the first entry fill;
    /// a Play without entry fills or a close time has no outcome.
    /// </summary>
    public static PlayOutcome? Outcome(ClosedPlayFacts facts)
    {
        var entries = facts.Fills.Where(f => f.Role == OrderLinkRole.Entry).Select(f => f.Fill).ToList();
        if (facts.Play.Status != PlayStatus.Closed || facts.Play.EndedAtUtc is not { } closedAt || entries.Count == 0) return null;
        var notional = entries.Sum(f => f.Quantity * f.Price);
        if (notional <= 0) return null;
        var fills = facts.Fills.Select(f => f.Fill).ToList();
        // A net-of-fee closed PnL already has its fee taken off; only gross PnL needs the fee subtracted.
        var gross = fills.Where(f => f.PnlBasis == ExecutionFacts.PnlGross).ToList();
        var net = fills.Sum(f => f.ClosedPnlUsd) - gross.Where(f => f.FeeToken == FeeToken).Sum(f => f.Fee);
        var feesComplete = gross.All(f => f.FeeToken == FeeToken || f.Fee == 0);
        var firstEntry = entries.Min(f => f.OccurredAtUtc);
        var revisions = facts.Revisions.OrderBy(r => r.Number).ToList();
        var plan = (revisions.LastOrDefault(r => r.CreatedAtUtc <= firstEntry) ?? revisions.FirstOrDefault())?.Plan ?? facts.Play.Plan;
        decimal? risk = StopDistance(PlayDocuments.Read(plan)) is { } distance ? notional * distance : null;
        return new PlayOutcome(facts.Play.Id, closedAt, net, notional, risk, feesComplete);
    }

    /// <summary>
    /// The share-weighted price distance to the stops over the share-weighted entry, as a fraction. Stop shares
    /// are normalized within each entry; entries or stops without a price are skipped.
    /// </summary>
    public static decimal? StopDistance(PlayPlanDocument plan)
    {
        var stops = ExecutionMatcher.Levels(plan).Where(l => l.Role == OrderLinkRole.Stop && l.Price is > 0).ToLookup(l => l.EntryId!);
        decimal loss = 0, entry = 0;
        foreach (var item in plan.Entries)
        {
            if (Positive(item.Price) is not { } price || Positive(item.Share) is not { } share) continue;
            var weighted = item.Stops.Select(stop => (Share: Positive(stop.Share), Price: stops[item.Id].FirstOrDefault(l => l.LevelId == stop.Id)?.Price))
                .Where(s => s is { Share: not null, Price: not null }).ToList();
            var shares = weighted.Sum(s => s.Share!.Value);
            if (shares <= 0) continue;
            loss += share * weighted.Sum(s => s.Share!.Value * Math.Abs(price - s.Price!.Value)) / shares;
            entry += share * price;
        }
        return entry > 0 && loss > 0 ? loss / entry : null;
    }

    private static decimal? Positive(string text) =>
        decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0 ? value : null;

}
