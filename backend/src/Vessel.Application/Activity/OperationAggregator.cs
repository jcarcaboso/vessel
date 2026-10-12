using System.Numerics;
using Vessel.Application.Workspace;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Activity;

/// <summary>Position round trips from normalized facts, never Play intent or venue direction text.</summary>
public static class OperationAggregator
{
    // Nominal display only. Net results use USDC only, exactly like PlayOutcomeCalculator.
    private static readonly HashSet<string> Stablecoins = ["USDC", "USDT", "USDT0", "USDE", "USDe", "USDH"];
    public static IReadOnlyList<ActivityOperationDto> Aggregate(IEnumerable<ImportedFill> fills,
        IReadOnlyDictionary<Guid, Guid>? fillPlayIds = null)
    {
        var result = new List<ActivityOperationDto>();
        foreach (var group in fills.GroupBy(f => (f.AccountId, f.ContractId)))
        {
            Builder? current = null;
            ExactAmount position = default;
            // Retained facts have no authoritative intra-timestamp sequence. Opposing sides at the
            // same instant cannot be ordered by a random database UUID to manufacture a round trip.
            var ambiguousTimes = group.GroupBy(f => f.OccurredAtUtc).Where(g => g.Select(f => f.Side).Distinct().Count() > 1)
                .Select(g => g.Key).ToHashSet();
            foreach (var fill in group.OrderBy(f => f.OccurredAtUtc).ThenBy(f => f.Id))
            {
                var quantity = ExactAmount.From(fill.Quantity);
                var signed = fill.Side == ExecutionFacts.Buy ? quantity : -quantity;
                current ??= new Builder(fill, fill.PositionEffect == ExecutionFacts.Close ? -signed.Units.Sign : signed.Units.Sign);
                if (current.Incomplete)
                {
                    current.Add(fill, "unknown", quantity, true, fillPlayIds);
                    continue;
                }
                string? problem = ambiguousTimes.Contains(fill.OccurredAtUtc) ? "Opposing fills share a timestamp without an authoritative sequence; the position walk is ambiguous." :
                    fill.Quantity <= 0 || fill.Price <= 0 ? "Nonpositive quantity or price makes the position walk ambiguous." :
                    fill.PositionEffect == ExecutionFacts.Unknown ? "Unknown position effect makes this contract's remaining retained history ambiguous." :
                    fill.PositionEffect == ExecutionFacts.Open && !position.Units.IsZero && position.Units.Sign != signed.Units.Sign ? "An opening fill opposes the retained position." :
                    fill.PositionEffect is ExecutionFacts.Close or ExecutionFacts.Flip && position.Units.IsZero ? "Retained history begins with a reducing or flipping fill; its opening position is missing." :
                    fill.PositionEffect is ExecutionFacts.Close or ExecutionFacts.Flip && position.Units.Sign == signed.Units.Sign ? "A reducing fill has the same side as the retained position." :
                    fill.PositionEffect == ExecutionFacts.Close && quantity.CompareTo(position.Abs()) > 0 ? "A closing fill exceeds the retained position without a reported flip." :
                    fill.PositionEffect == ExecutionFacts.Flip && quantity.CompareTo(position.Abs()) <= 0 ? "A reported flip does not cross the retained position through zero." : null;
                if (problem is not null)
                {
                    current.Coverage.Add(problem);
                    current.Incomplete = true;
                    current.Add(fill, "unknown", quantity, true, fillPlayIds);
                    continue;
                }
                if (fill.PositionEffect == ExecutionFacts.Flip)
                {
                    var closing = position.Abs();
                    current.Add(fill, "exit", closing, true, fillPlayIds);
                    current.ClosedAt = fill.OccurredAtUtc;
                    result.Add(current.Build(default));
                    var remaining = quantity - closing;
                    current = new Builder(fill, signed.Units.Sign);
                    current.Add(fill, "entry", remaining, false, fillPlayIds);
                    position = signed.Units.Sign > 0 ? remaining : -remaining;
                    current.Peak = position.Abs();
                }
                else
                {
                    current.Add(fill, fill.PositionEffect == ExecutionFacts.Open ? "entry" : "exit", quantity, true, fillPlayIds);
                    position += signed;
                    if (position.Abs().CompareTo(current.Peak) > 0) current.Peak = position.Abs();
                    if (position.Units.IsZero)
                    {
                        current.ClosedAt = fill.OccurredAtUtc;
                        result.Add(current.Build(position));
                        current = null;
                    }
                }
            }
            if (current is not null) result.Add(current.Build(position));
        }
        return result.OrderByDescending(o => o.LastOccurredAtUtc).ThenBy(o => o.Id, StringComparer.Ordinal).ToList();
    }

    private sealed class Builder(ImportedFill first, int sign)
    {
        public bool Incomplete;
        public ExactAmount Peak;
        public DateTimeOffset? ClosedAt;
        public List<string> Coverage = [];
        private readonly List<OperationFillDto> parts = [];
        private readonly HashSet<string> entries = [], exits = [];
        private readonly HashSet<string> bases = [];
        private readonly Dictionary<string, ExactAmount> fees = new(StringComparer.Ordinal);
        private readonly HashSet<Guid> plays = [];
        private bool unassigned, unsupportedGrossFee;
        private ExactAmount entered, exited, pnl, grossFees;
        private BigInteger entryNotional, exitNotional;
        public void Add(ImportedFill fill, string role, ExactAmount quantity, bool monetary, IReadOnlyDictionary<Guid, Guid>? links)
        {
            Guid? play = links?.TryGetValue(fill.Id, out var linked) == true ? linked : null;
            if (play is { } id) plays.Add(id); else unassigned = true;
            var fee = monetary ? ExactAmount.From(fill.Fee) : default;
            var closedPnl = monetary ? ExactAmount.From(fill.ClosedPnlUsd) : default;
            pnl += closedPnl;
            bases.Add(fill.PnlBasis);
            fees[fill.FeeToken] = fees.GetValueOrDefault(fill.FeeToken) + fee;
            if (fill.PnlBasis == ExecutionFacts.PnlGross)
            {
                if (fill.FeeToken == "USDC") grossFees += fee;
                else if (!fee.Units.IsZero) unsupportedGrossFee = true;
            }
            if (role == "entry") { entered += quantity; entryNotional += quantity.Units * ExactAmount.From(fill.Price).Units; if (!string.IsNullOrWhiteSpace(fill.OrderId)) entries.Add(fill.OrderId); }
            if (role == "exit") { exited += quantity; exitNotional += quantity.Units * ExactAmount.From(fill.Price).Units; if (!string.IsNullOrWhiteSpace(fill.OrderId)) exits.Add(fill.OrderId); }
            parts.Add(new(new(fill.Id, fill.AccountId, fill.ContractId, fill.Side, fill.Direction,
                ExactAmount.From(fill.Price).ToString(), ExactAmount.From(fill.Quantity).ToString(), ExactAmount.From(fill.Fee).ToString(),
                fill.FeeToken, ExactAmount.From(fill.ClosedPnlUsd).ToString(), fill.OccurredAtUtc, fill.OrderId, fill.SourceFillId,
                fill.TransactionHash, fill.PositionEffect, fill.FeeBasis, fill.PnlBasis, play), role, quantity.ToString(), fee.ToString(), closedPnl.ToString()));
        }
        public ActivityOperationDto Build(ExactAmount position)
        {
            if (unsupportedGrossFee) Coverage.Add("Net result is unknown: a gross fill has a non-USDC fee; no fee conversion is performed.");
            if (parts.Any(p => string.IsNullOrWhiteSpace(p.Fill.OrderId))) Coverage.Add("Some order IDs are missing; distinct order counts include known IDs only.");
            var association = plays.Count == 0 ? "unassigned" : plays.Count == 1 && !unassigned ? "linked" : "mixed";
            var stableFees = fees.Where(f => Stablecoins.Contains(f.Key)).Aggregate(default(ExactAmount), (sum, f) => sum + f.Value);
            return new($"{first.Id}:{(sign > 0 ? "long" : "short")}", first.AccountId, first.ContractId,
                Incomplete ? null : sign > 0 ? "long" : "short", Incomplete ? "incomplete" : ClosedAt is null ? "open" : "closed",
                Incomplete ? null : first.OccurredAtUtc, ClosedAt, parts[^1].Fill.OccurredAtUtc,
                Incomplete ? null : Peak.ToString(), Incomplete ? null : entered.ToString(), Incomplete ? null : exited.ToString(),
                Incomplete ? null : position.Abs().ToString(), Incomplete ? null : ExactAmount.Average(entryNotional, entered),
                Incomplete ? null : ExactAmount.Average(exitNotional, exited), entries.Count, exits.Count, parts.Count,
                pnl.ToString(), stableFees.ToString(), fees.Where(f => !Stablecoins.Contains(f.Key)).OrderBy(f => f.Key, StringComparer.Ordinal)
                    .Select(f => new OperationFeeDto(f.Key, f.Value.ToString())).ToList(), unsupportedGrossFee ? null : (pnl - grossFees).ToString(),
                bases.Count == 1 ? bases.Single() : "mixed", association == "linked" ? plays.Single() : null, association, Coverage, parts);
        }
    }
}
