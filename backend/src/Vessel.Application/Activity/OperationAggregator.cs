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
        IReadOnlyDictionary<Guid, Guid>? fillPlayIds = null, IReadOnlyList<AccountSnapshot>? snapshots = null)
    {
        var result = new List<ActivityOperationDto>();
        foreach (var group in fills.GroupBy(f => (f.AccountId, f.ContractId)))
        {
            var times = group.GroupBy(f => f.OccurredAtUtc).OrderBy(g => g.Key).ToList();
            var snapshot = snapshots?.SingleOrDefault(s => s.AccountId == group.Key.AccountId);
            var anchored = snapshot is not null && snapshot.ObservedAtUtc >= times[^1].Key && group.All(f => f.Quantity > 0);
            // Addition is order-independent. This is the backward walk's position before the first fill.
            var position = anchored ? ExactAmount.From(snapshot!.Positions.SingleOrDefault(p => p.ContractId == group.Key.ContractId)?.SignedQuantity ?? 0m)
                - group.Aggregate(default(ExactAmount), (sum, f) => sum + Signed(f)) : default;
            var known = anchored || times[0].All(f => f.PositionEffect == ExecutionFacts.Open) && times[0].Select(f => f.Side).Distinct().Count() == 1;
            var unknownDirection = 0;
            Builder? current = null;
            foreach (var time in times)
            {
                var (ordered, ambiguous) = OrderTimestamp(time, known ? position : null);
                foreach (var fill in ordered)
                {
                    var quantity = ExactAmount.From(fill.Quantity);
                    var signed = Signed(fill);
                    // A close proves the unknown position's direction, not its size. Opening the
                    // opposite position proves flatness between those fills. Reopening the same
                    // direction could just be another increase and cannot resynchronize the walk.
                    if (!known && !ambiguous && fill.Quantity > 0 && fill.PositionEffect == ExecutionFacts.Open && unknownDirection == -signed.Units.Sign)
                    {
                        if (current is not null) result.Add(current.Build(default));
                        current = null;
                        position = default;
                        known = true;
                    }
                    if (!known)
                    {
                        current ??= new Builder(fill, fill.PositionEffect == ExecutionFacts.Close ? -signed.Units.Sign : signed.Units.Sign);
                        current.UnknownBoundaries = true;
                        current.Note(ambiguous ? TimestampNotice : "Retained opening history or position effect is unknown; position boundaries are unavailable until flatness is proved.");
                        current.Add(fill, "unknown", quantity, true, fillPlayIds);
                        unknownDirection = ambiguous || fill.Quantity <= 0 ? 0 : fill.PositionEffect switch
                        {
                            ExecutionFacts.Close => -signed.Units.Sign,
                            ExecutionFacts.Open or ExecutionFacts.Flip => signed.Units.Sign,
                            _ => 0
                        };
                        continue;
                    }
                    var valid = EffectMatches(fill, position);
                    if (!anchored && (!valid || fill.PositionEffect == ExecutionFacts.Unknown || fill.Quantity <= 0 || fill.Price <= 0))
                    {
                        current ??= new Builder(fill, position.Units.IsZero ? signed.Units.Sign : position.Units.Sign);
                        current.UnknownBoundaries = true;
                        current.Note("Position effect contradicts the retained position or is unknown; position boundaries need a new proof of flatness.");
                        if (ambiguous) current.Note(TimestampNotice);
                        current.Add(fill, "unknown", quantity, true, fillPlayIds);
                        known = false;
                        unknownDirection = 0; // A contradictory label is not a proof of direction.
                        continue;
                    }
                    current ??= new Builder(fill, position.Units.IsZero ? signed.Units.Sign : position.Units.Sign)
                    {
                        MissingEntries = !position.Units.IsZero,
                        Peak = position.Abs()
                    };
                    if (current.MissingEntries) current.Note("Opening entries precede retained history and are missing; entry quantity, entry average and opening time are unknown.");
                    if (ambiguous) { current.UnknownBoundaries = true; current.Note(TimestampNotice); }
                    if (!valid) current.Note($"Position effect '{fill.PositionEffect}' contradicts snapshot-anchored quantities in this operation; boundaries use side and quantity.");
                    if (fill.Price <= 0) { current.UnknownBoundaries = true; current.Note("Nonpositive price makes weighted prices unavailable."); }
                    var after = position + signed;
                    var reducing = !position.Units.IsZero && position.Units.Sign != signed.Units.Sign;
                    var crosses = reducing && !after.Units.IsZero && after.Units.Sign != position.Units.Sign;
                    if (crosses)
                    {
                        current.Add(fill, "exit", position.Abs(), true, fillPlayIds);
                        current.ClosedAt = fill.OccurredAtUtc;
                        result.Add(current.Build(default));
                        current = new Builder(fill, signed.Units.Sign) { Peak = after.Abs(), UnknownBoundaries = ambiguous || fill.Price <= 0 };
                        if (ambiguous) current.Note(TimestampNotice);
                        if (fill.Price <= 0) current.Note("Nonpositive price makes weighted prices unavailable.");
                        if (!valid) current.Note($"Position effect '{fill.PositionEffect}' contradicts snapshot-anchored quantities in this operation; boundaries use side and quantity.");
                        current.Add(fill, "entry", after.Abs(), false, fillPlayIds);
                    }
                    else
                    {
                        current.Add(fill, reducing ? "exit" : "entry", quantity, true, fillPlayIds);
                        if (after.Abs().CompareTo(current.Peak) > 0) current.Peak = after.Abs();
                        if (after.Units.IsZero)
                        {
                            current.ClosedAt = fill.OccurredAtUtc;
                            result.Add(current.Build(after));
                            current = null;
                        }
                    }
                    position = after;
                }
            }
            if (current is not null) result.Add(current.Build(position));
        }
        return result.OrderByDescending(o => o.LastOccurredAtUtc).ThenBy(o => o.Id, StringComparer.Ordinal).ToList();
    }

    private const string TimestampNotice = "Fills share a timestamp with no unique effect-consistent operation boundary; only operations touching this timestamp are ambiguous.";
    private static ExactAmount Signed(ImportedFill fill) => fill.Side == ExecutionFacts.Buy ? ExactAmount.From(fill.Quantity) : -ExactAmount.From(fill.Quantity);
    private static bool EffectMatches(ImportedFill fill, ExactAmount before)
    {
        var signed = Signed(fill);
        var same = before.Units.IsZero || before.Units.Sign == signed.Units.Sign;
        return fill.Quantity > 0 && fill.PositionEffect switch
        {
            ExecutionFacts.Open => same,
            ExecutionFacts.Close => !same && signed.Abs().CompareTo(before.Abs()) <= 0,
            ExecutionFacts.Flip => !same && signed.Abs().CompareTo(before.Abs()) > 0,
            ExecutionFacts.Unknown => true,
            _ => false
        };
    }

    private static (IReadOnlyList<ImportedFill> Fills, bool Ambiguous) OrderTimestamp(IEnumerable<ImportedFill> time, ExactAmount? position)
    {
        var rows = time.OrderBy(f => f.PositionEffect == ExecutionFacts.Close ? 0 : f.PositionEffect == ExecutionFacts.Flip ? 1 : 2)
            .ThenBy(f => f.Id).ToArray();
        if (rows.Length == 1) return (rows, false);
        if (position is null)
        {
            // With unknown size, same-side closes before opens can prove a direction change.
            // Opposing-side ties cannot prove the size or which position their opens increased.
            return (rows, rows.Select(f => f.Side).Distinct().Count() > 1 || rows.Any(f => f.PositionEffect is ExecutionFacts.Flip or ExecutionFacts.Unknown));
        }
        if (rows.Select(f => f.Side).Distinct().Count() == 1 && rows.All(f => f.Quantity > 0))
        {
            var sameSide = position.Value.Units.IsZero || position.Value.Units.Sign == Signed(rows[0]).Units.Sign;
            var total = rows.Aggregate(default(ExactAmount), (sum, f) => sum + ExactAmount.From(f.Quantity));
            if (sameSide && rows.All(f => f.PositionEffect is ExecutionFacts.Open or ExecutionFacts.Unknown) ||
                !sameSide && total.CompareTo(position.Value.Abs()) <= 0 && rows.All(f => f.PositionEffect is ExecutionFacts.Close or ExecutionFacts.Unknown))
                return (rows, false); // No internal boundary, regardless of order or burst size.
            var closed = rows.Where(f => f.PositionEffect == ExecutionFacts.Close)
                .Aggregate(default(ExactAmount), (sum, f) => sum + ExactAmount.From(f.Quantity));
            if (!sameSide && closed == position.Value.Abs() && rows.All(f => f.PositionEffect is ExecutionFacts.Close or ExecutionFacts.Open))
                return (rows, false); // All closes must finish before this opposite-position open.
        }

        // ponytail: cap unusual timestamp bursts, conservatively flag their operations instead of
        // factorial work. Ordinary bursts without internal boundaries take the linear path.
        if (rows.Length > 12) return (rows, true);
        var used = new bool[rows.Length];
        var path = new List<ImportedFill>();
        ImportedFill[]? chosen = null;
        string? signature = null;
        var ambiguous = false;
        var visited = 0;
        var states = new HashSet<string>(StringComparer.Ordinal);
        void Search(ExactAmount before, int operation, List<string> allocations)
        {
            if (ambiguous) return;
            if (!states.Add($"{string.Join("", used.Select(u => u ? '1' : '0'))}:{operation}:{string.Join("|", allocations.Order(StringComparer.Ordinal))}")) return;
            if (++visited > 4096) { ambiguous = true; return; }
            if (path.Count == rows.Length)
            {
                var candidate = string.Join("|", allocations.Order(StringComparer.Ordinal));
                if (chosen is null) { chosen = path.ToArray(); signature = candidate; }
                else if (signature != candidate) ambiguous = true;
                return;
            }
            for (var i = 0; i < rows.Length; i++)
            {
                var fill = rows[i];
                if (used[i] || !EffectMatches(fill, before)) continue;
                var after = before + Signed(fill);
                var reducing = !before.Units.IsZero && before.Units.Sign != Signed(fill).Units.Sign;
                var crosses = reducing && !after.Units.IsZero && before.Units.Sign != after.Units.Sign;
                var next = operation;
                var added = new List<string>(allocations);
                if (crosses)
                {
                    added.Add($"{fill.Id}:{operation}:exit:{before.Abs()}");
                    added.Add($"{fill.Id}:{++next}:entry:{after.Abs()}");
                }
                else
                {
                    added.Add($"{fill.Id}:{operation}:{(reducing ? "exit" : "entry")}:{ExactAmount.From(fill.Quantity)}");
                    if (after.Units.IsZero) next++;
                }
                used[i] = true; path.Add(fill);
                Search(after, next, added);
                path.RemoveAt(path.Count - 1); used[i] = false;
                if (ambiguous) break;
            }
        }
        Search(position.Value, 0, []);
        return (chosen ?? rows, ambiguous || chosen is null);
    }

    private sealed class Builder(ImportedFill first, int sign)
    {
        public bool UnknownBoundaries, MissingEntries;
        public void Note(string notice) { if (!Coverage.Contains(notice)) Coverage.Add(notice); }
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
                UnknownBoundaries ? null : sign > 0 ? "long" : "short", UnknownBoundaries || MissingEntries ? "incomplete" : ClosedAt is null ? "open" : "closed",
                UnknownBoundaries || MissingEntries ? null : first.OccurredAtUtc, UnknownBoundaries ? null : ClosedAt, parts[^1].Fill.OccurredAtUtc,
                UnknownBoundaries || MissingEntries ? null : Peak.ToString(), UnknownBoundaries || MissingEntries ? null : entered.ToString(), UnknownBoundaries ? null : exited.ToString(),
                UnknownBoundaries ? null : position.Abs().ToString(), UnknownBoundaries || MissingEntries ? null : ExactAmount.Average(entryNotional, entered),
                UnknownBoundaries ? null : ExactAmount.Average(exitNotional, exited), entries.Count, exits.Count, parts.Count,
                pnl.ToString(), stableFees.ToString(), fees.Where(f => !Stablecoins.Contains(f.Key)).OrderBy(f => f.Key, StringComparer.Ordinal)
                    .Select(f => new OperationFeeDto(f.Key, f.Value.ToString())).ToList(), unsupportedGrossFee ? null : (pnl - grossFees).ToString(),
                bases.Count == 1 ? bases.Single() : "mixed", association == "linked" ? plays.Single() : null, association, Coverage, parts);
        }
    }
}
