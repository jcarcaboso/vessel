using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;
using Vessel.Application.Common;
using Vessel.Application.Sizing;
using Vessel.Application.Activity;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Plays;

/// <summary>Chronological average-cost accounting of owner-entered facts, never venue-reported PnL.</summary>
public static partial class ManualLedger
{
    public sealed record Result(decimal Entered, decimal Exited, decimal Gross, decimal? Net, bool FeesComplete,
        IReadOnlyList<LinkedFill> Projection, DateTimeOffset? ClosedAt)
    {
        public decimal Open => Entered - Exited;
    }

    public static Result Calculate(Play play, IEnumerable<ManualExecution> records)
    {
        decimal entered = 0, exited = 0, open = 0, fees = 0, entryNotional = 0;
        ExactAmount cost = default, gross = default;
        var complete = true;
        var roundedCost = false;
        List<LinkedFill> projection = [];
        var side = PlayDocuments.Read(play.Plan).Direction == "long" ? ExecutionFacts.Buy : ExecutionFacts.Sell;
        try
        {
            var rows = records.ToList();
            var notionalBound = rows.Aggregate(default(ExactAmount), (sum, row) =>
                sum + ExactAmount.From(Multiply(Number(row.Quantity, true), Number(row.Price, true))));
            var whole = notionalBound.Units / BigInteger.Pow(10, 28);
            // Inexact allocations leave coefficient headroom for later exits, without rounding submitted facts.
            var allocationScale = Math.Max(0, 28 - (whole.IsZero ? 0 : whole.ToString(CultureInfo.InvariantCulture).Length));
            foreach (var group in rows.GroupBy(r => r.OccurredAtUtc).OrderBy(g => g.Key))
            {
                if (group.Select(r => r.Role).Distinct().Count() != 1)
                    throw new ProblemException(409, "Entry and exit facts at the same timestamp have ambiguous cost ordering.");
                foreach (var row in group.OrderBy(r => r.Id))
                {
                    var entry = row.Role == "entry";
                    if (row.Role is not ("entry" or "exit") || row.Side != (entry ? side : side == ExecutionFacts.Buy ? ExecutionFacts.Sell : ExecutionFacts.Buy))
                        throw new ProblemException(409, $"Execution {row.Id} contradicts the Play's direction or role.");
                    var quantity = Number(row.Quantity, positive: true);
                    var price = Number(row.Price, positive: true);
                    decimal pnl = 0;
                    if (entry)
                    {
                        if (entered > 0 && open == 0)
                            throw new ProblemException(409, "A manual ledger cannot reopen a completed round trip.");
                        entered = Add(entered, quantity); open = Add(open, quantity);
                        var notional = Multiply(quantity, price);
                        cost += ExactAmount.From(notional); entryNotional = Add(entryNotional, notional);
                    }
                    else
                    {
                        if (quantity > open) throw new ProblemException(409, $"Execution {row.Id} exits more than the quantity open at its timestamp.");
                        var closing = quantity == open;
                        var costNumerator = cost.Units * ExactAmount.From(quantity).Units;
                        var openAmount = ExactAmount.From(open);
                        var allocatedCost = closing ? cost : ExactAmount.Parse(ExactAmount.Average(
                            costNumerator, openAmount)!);
                        var notional = ExactAmount.From(Multiply(quantity, price));
                        pnl = Derived(side == ExecutionFacts.Buy ? notional - allocatedCost : allocatedCost - notional, exact: closing);
                        if (!closing && (roundedCost || costNumerator % openAmount.Units != 0))
                        {
                            pnl = decimal.Round(pnl, allocationScale, MidpointRounding.ToEven);
                            roundedCost = true;
                        }
                        // Carry any derived rounding in the remaining cost; the final close consumes it all.
                        cost = closing ? default : cost - (side == ExecutionFacts.Buy
                            ? notional - ExactAmount.From(pnl) : notional + ExactAmount.From(pnl));
                        open = Add(open, -quantity); exited = Add(exited, quantity);
                        gross += ExactAmount.From(pnl);
                    }
                    var known = row.Fee is not null && row.FeeCurrency is not null;
                    var fee = known ? Number(row.Fee!, positive: false) : 0;
                    complete &= known && (row.FeeCurrency == "USDC" || fee == 0);
                    if (row.FeeCurrency == "USDC") fees = Add(fees, fee);
                    projection.Add(new(entry ? OrderLinkRole.Entry : OrderLinkRole.Exit, new ImportedFill
                    {
                        Id = row.Id, OwnerId = play.OwnerId, AccountId = play.AccountId, ContractId = play.ContractId!,
                        SourceFillId = row.Id.ToString(), OrderId = $"manual:{row.Id}", Direction = row.Source,
                        Side = row.Side, PositionEffect = entry ? ExecutionFacts.Open : ExecutionFacts.Close,
                        Quantity = quantity, Price = price, Fee = fee, FeeToken = row.FeeCurrency ?? "",
                        FeeBasis = known ? ExecutionFacts.FeeReported : "unknown", PnlBasis = ExecutionFacts.PnlGross,
                        ClosedPnlUsd = pnl, OccurredAtUtc = row.OccurredAtUtc, TransactionHash = ""
                    }));
                }
            }
        }
        catch (OverflowException) { throw new ProblemException(400, "Manual ledger exceeds the supported decimal range."); }
        return new(entered, exited, Derived(gross, exact: open == 0),
            complete ? Derived(gross - ExactAmount.From(fees), exact: open == 0) : null, complete, projection,
            entered > 0 && open == 0 ? projection.Max(f => f.Fill.OccurredAtUtc) : null);
    }

    // Partial allocations may round and carry cost, but a final exit must consume that cost exactly.
    private static decimal Derived(ExactAmount value, bool exact = false)
    {
        if (!decimal.TryParse(value.ToString(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
            CultureInfo.InvariantCulture, out var result))
            throw new ProblemException(400, "Manual ledger exceeds the supported decimal range.");
        if (exact && ExactAmount.From(result) != value)
            throw new ProblemException(400, "Manual ledger result exceeds exact decimal precision.");
        return result;
    }

    private static decimal Add(decimal a, decimal b)
    {
        decimal value;
        try { value = a + b; }
        catch (OverflowException) { throw new ProblemException(400, "Manual ledger exceeds the supported decimal range."); }
        if (ExactAmount.From(value).Units != ExactAmount.From(a).Units + ExactAmount.From(b).Units)
            throw new ProblemException(400, "Manual ledger amounts exceed exact decimal precision.");
        return value;
    }
    private static decimal Multiply(decimal a, decimal b)
    {
        var value = a * b;
        if (ExactAmount.From(value).Units * BigInteger.Pow(10, 28) != ExactAmount.From(a).Units * ExactAmount.From(b).Units)
            throw new ProblemException(400, "Manual ledger notional exceeds exact decimal precision.");
        return value;
    }

    // Reject rounding at input. Preserve the exact submitted string, including scientific notation.
    public static decimal Number(string text, bool positive)
    {
        if (text is null || text.Length > 96 || !NumberPattern().IsMatch(text) ||
            !decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ||
            (positive ? value <= 0 : value < 0))
            throw new ProblemException(400, positive ? "Quantity and price must be positive decimal strings." : "Fees must be nonnegative decimal strings.");
        var pieces = text.ToLowerInvariant().Split('e');
        var mantissa = pieces[0].TrimStart('+');
        var fraction = mantissa.IndexOf('.') is var dot && dot >= 0 ? mantissa.Length - dot - 1 : 0;
        var coefficient = BigInteger.Parse(mantissa.Replace(".", ""), CultureInfo.InvariantCulture);
        var scale = fraction - (pieces.Length == 2 ? int.Parse(pieces[1], CultureInfo.InvariantCulture) : 0);
        if (scale is < -96 or > 96) throw new ProblemException(400, "Decimal is outside the supported range.");
        var bits = decimal.GetBits(value);
        var parsed = (BigInteger)(uint)bits[0] | ((BigInteger)(uint)bits[1] << 32) | ((BigInteger)(uint)bits[2] << 64);
        var parsedScale = (bits[3] >> 16) & 0xff;
        if (coefficient * BigInteger.Pow(10, Math.Max(0, parsedScale - scale)) !=
            parsed * BigInteger.Pow(10, Math.Max(0, scale - parsedScale)))
            throw new ProblemException(400, "Decimal must be exactly representable, without rounding.");
        return value;
    }
    public static string Text(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    [GeneratedRegex(@"^\+?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$")]
    private static partial Regex NumberPattern();
}
