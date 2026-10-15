using System.Numerics;
using System.Text.Json;
using Vessel.Domain.Numerics;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Sizing;
using Vessel.Application.Venues;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Monitoring;

public sealed partial class MonitorDiscrepancyService
{
    private static readonly string[] PlayKinds = ["protection.missing", "protection.cancelled", "protection.short", "protection.excess", "protection.orphaned", "level.drift"];
    private static readonly string[] PositionKinds = ["position.missing", "position.opposite", "position.short", "position.excess", "fill.unlinked"];
    private sealed record Finding(string Kind, string Subject, Guid? PlayId, string Contract, string Native, string Severity,
        bool? Present, DateTimeOffset At, Guid[] PlayIds, object Details);
    private sealed class Scan
    {
        public List<Finding> Findings { get; } = [];
        public bool Incomplete { get; set; }
        public DateTimeOffset? Next { get; set; }
        public void Add(Finding finding) { Findings.Add(finding); Incomplete |= finding.Present is null; }
    }
    private sealed record PlayFacts(Play Play, PlayPlanDocument Plan, VenueInstrument Instrument,
        PlayOrderLink[] Links, LinkedFill[] Fills, ExactAmount Quantity, DateTimeOffset? FirstEntry,
        DateTimeOffset? LastFill, bool Valid);

    private Scan Observe(MonitorEvaluation observation, MonitorDiscrepancyFacts facts, DateTimeOffset now)
    {
        var scan = new Scan { Incomplete = observation.HistoryGap || !facts.Complete };
        if (!facts.Complete) return scan;
        var sync = observation.Read.Sync;
        var orders = observation.Read.Orders;
        var snapshotAt = sync.Snapshot.ObservedAtUtc;
        bool Fresh(DateTimeOffset at) => at <= now && at >= now - MonitorOptions.Lease &&
            (observation.PreviousSuccessAtUtc is null || at > observation.PreviousSuccessAtUtc);
        var positionsFresh = Fresh(snapshotAt) && sync.PositionsComplete;
        var ordersFresh = orders is not null && Fresh(orders.ObservedAtUtc);
        // Current-book adapters stamp open rows with the read time. Historical Open statuses are not current evidence.
        var currentOrders = orders?.Orders.GroupBy(x => x.OrderId).Where(x => x.Count() == 1).ToDictionary(x => x.Key, x => x.Single()) ?? [];
        var duplicateOrders = orders?.Orders.GroupBy(x => x.OrderId).Any(x => x.Count() != 1) == true;
        var allLinks = facts.Links.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id).ToArray();
        var assignmentsComplete = facts.AssignmentLinksComplete && facts.AssignmentLinks is not null;
        scan.Incomplete |= !assignmentsComplete;
        var assigned = (facts.AssignmentLinks ?? []).Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id &&
            x.State is OrderLinkState.Linked or OrderLinkState.Suggested).Select(x => x.OrderId).ToHashSet(StringComparer.Ordinal);
        var retainedFills = facts.Fills.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id).ToArray();
        var retainedOrders = facts.Orders.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id).ToArray();
        var linked = allLinks.Where(x => x.State == OrderLinkState.Linked).ToArray();
        var shared = linked.GroupBy(x => x.OrderId).Where(g => g.Count() != 1).Select(x => x.Key).ToHashSet();
        var plays = new List<PlayFacts>();
        foreach (var play in facts.Plays.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id &&
                     x.InstrumentSource == InstrumentSource.Venue && x.Origin == PlayOrigin.Planned && x.Status != PlayStatus.Draft))
        {
            var instruments = sync.Instruments.Where(x => x.ContractId == play.ContractId).ToArray();
            if (instruments.Length != 1 || instruments[0].QuantityDecimals is < 0 or > 28)
            {
                foreach (var kind in PlayKinds) scan.Add(new(kind, "play:" + play.Id, play.Id, play.ContractId ?? "", "", Severity(kind), null, snapshotAt, [play.Id], new { }));
                continue;
            }
            var instrument = instruments[0];
            var plan = PlayDocuments.Read(play.Plan);
            var links = linked.Where(x => x.PlayId == play.Id).OrderBy(x => x.OrderId, StringComparer.Ordinal).ToArray();
            var linkMap = links.GroupBy(x => x.OrderId).ToDictionary(x => x.Key, x => x.First());
            var fills = retainedFills.Where(x => linkMap.ContainsKey(x.OrderId)).Select(x => new LinkedFill(linkMap[x.OrderId].Role, x)).ToArray();
            var knownOrders = retainedOrders.Where(x => linkMap.ContainsKey(x.OrderId)).ToArray();
            var missing = knownOrders.Where(x => ExecutionIntegrity.MissingExecutions(x, fills.Where(f => f.Fill.OrderId == x.OrderId).Select(f => f.Fill))).Select(x => x.OrderId);
            var valid = !links.Any(x => shared.Contains(x.OrderId)) &&
                fills.All(x => Same(instrument, x.Fill.ContractId, x.Fill.VenueContractId) && x.Fill.Quantity > 0 && ExecutionFacts.IsSide(x.Fill.Side)) &&
                knownOrders.All(x => Same(instrument, x.ContractId, x.VenueContractId) &&
                    ExecutionIntegrity.RoleConflict(linkMap[x.OrderId].Role, plan, x, fills.Where(f => f.Fill.OrderId == x.OrderId).Select(f => f.Fill)) is null) &&
                ExecutionIntegrity.Problems(ExecutionIntegrity.EntrySide(plan), fills, missing).Count == 0;
            var counted = fills.Where(x => !ExecutionIntegrity.Contradicts(x.Role, ExecutionIntegrity.EntrySide(plan), x.Fill)).ToArray();
            var entered = counted.Where(x => x.Role == OrderLinkRole.Entry).ToArray();
            var quantity = ExecutionIntegrity.Quantity(entered.Select(x => x.Fill)) - ExecutionIntegrity.Quantity(counted.Where(x => x.Role != OrderLinkRole.Entry).Select(x => x.Fill));
            if (play.Status == PlayStatus.Open && (entered.Length == 0 || quantity.Units.Sign <= 0)) valid = false;
            var context = new PlayFacts(play, plan, instrument, links, fills, quantity,
                entered.Length == 0 ? null : entered.Min(x => x.Fill.OccurredAtUtc),
                fills.Length == 0 ? null : fills.Max(x => x.Fill.OccurredAtUtc), valid);
            plays.Add(context);
            ObservePlay(context);
        }

        // Include instruments without open Plays: a nonzero venue position is untracked exposure.
        foreach (var instrumentGroup in sync.Instruments.GroupBy(x => x.ContractId))
        {
            if (instrumentGroup.Count() != 1) { scan.Incomplete = true; continue; }
            var instrument = instrumentGroup.Single();
            var involved = plays.Where(x => x.Play.Status == PlayStatus.Open && x.Instrument == instrument).OrderBy(x => x.Play.Id).ToArray();
            var ids = involved.Select(x => x.Play.Id).ToArray();
            var positions = sync.Snapshot.Positions.Where(x => x.ContractId == instrument.ContractId).ToArray();
            var valid = positionsFresh && !observation.HistoryGap && instrument.QuantityDecimals is >= 0 and <= 28 &&
                involved.All(x => x.Valid && x.LastFill <= snapshotAt) && positions.Length <= 1 &&
                positions.All(x => Same(instrument, x.ContractId, x.VenueContractId));
            var expected = involved.Aggregate(default(ExactAmount), (sum, p) => sum + (p.Plan.Direction == "long" ? p.Quantity : -p.Quantity));
            var actual = positions.Aggregate(default(ExactAmount), (sum, p) => sum + ExactAmount.From(p.SignedQuantity));
            var expectedUnits = Rounded(expected, instrument.QuantityDecimals);
            var actualUnits = Rounded(actual, instrument.QuantityDecimals);
            var kind = actualUnits == expectedUnits ? null : actualUnits.IsZero && !expectedUnits.IsZero ? "position.missing" :
                !expectedUnits.IsZero && actualUnits.Sign != expectedUnits.Sign ? "position.opposite" :
                BigInteger.Abs(actualUnits) < BigInteger.Abs(expectedUnits) ? "position.short" : "position.excess";
            var details = new { playIds = ids, nativeContractId = Native(instrument), expectedQuantity = expected.ToString(), venueQuantity = actual.ToString(),
                plays = involved.Select(x => new { playId = x.Play.Id, direction = x.Plan.Direction, quantity = x.Quantity.ToString(),
                    orders = x.Fills.GroupBy(f => (f.Fill.OrderId, f.Role)).OrderBy(g => g.Key.OrderId, StringComparer.Ordinal)
                        .Select(g => new { orderId = g.Key.OrderId, role = g.Key.Role.ToString(),
                            quantity = ExecutionIntegrity.Quantity(g.Select(f => f.Fill)).ToString() }).ToArray() }).ToArray() };
            foreach (var type in PositionKinds.Where(x => x != "fill.unlinked"))
                scan.Add(new(type, Subject(instrument), null, instrument.ContractId, Native(instrument), Severity(type), valid ? type == kind : null, snapshotAt, ids, details));
            var earliest = involved.Where(x => x.FirstEntry is not null).Select(x => x.FirstEntry!.Value).DefaultIfEmpty(DateTimeOffset.MaxValue).Min();
            var unlinked = retainedFills.Where(x => Same(instrument, x.ContractId, x.VenueContractId) && x.OccurredAtUtc > earliest &&
                !assigned.Contains(x.OrderId)).OrderBy(x => x.SourceFillId, StringComparer.Ordinal).ToArray();
            // A retained positive fact remains unlinked even after leaving the bounded recent venue window.
            // Linking/suggestion is local evidence of resolution; absence from recent fills never is.
            var ambiguousFills = retainedFills.Any(x => x.ContractId == instrument.ContractId && x.OccurredAtUtc > earliest &&
                !assigned.Contains(x.OrderId) && !Same(instrument, x.ContractId, x.VenueContractId));
            var fillKnown = assignmentsComplete && Fresh(snapshotAt) && !observation.HistoryGap && !ambiguousFills && involved.All(x => x.Valid) &&
                unlinked.All(x => x.OccurredAtUtc <= snapshotAt);
            scan.Add(new("fill.unlinked", Subject(instrument), null, instrument.ContractId, Native(instrument), "warning", fillKnown ? unlinked.Length > 0 : null,
                snapshotAt, ids, new { playIds = ids, nativeContractId = Native(instrument), fills = unlinked.Select(x => new {
                    fillId = x.SourceFillId, orderId = x.OrderId, side = x.Side, quantity = ExactAmount.From(x.Quantity).ToString() }).ToArray() }));
        }
        // Unknown native products cannot be silently counted under a canonical alias.
        if (sync.Snapshot.Positions.Any(p => !sync.Instruments.Any(i => Same(i, p.ContractId, p.VenueContractId)))) scan.Incomplete = true;
        return scan;

        void ObservePlay(PlayFacts p)
        {
            var play = p.Play;
            var at = orders?.ObservedAtUtc ?? snapshotAt;
            // Bounded history falling out of the read does not erase an already retained cancellation.
            // Only rows actually in this current read can establish a resting order.
            var scoped = p.Links.Select(l => (Link: l, Order: currentOrders.GetValueOrDefault(l.OrderId) ??
                RetainedOrder(retainedOrders.SingleOrDefault(x => x.OrderId == l.OrderId)))).ToArray();
            bool Resting(VenueOrder? order) => order is { Status: VenueOrderStatus.Open } &&
                currentOrders.ContainsKey(order.OrderId) && order.StatusAtUtc == at;
            var identityKnown = scoped.All(x => x.Order is null || Same(p.Instrument, x.Order.ContractId, x.Order.VenueContractId));
            var knownOrders = ordersFresh && !duplicateOrders && identityKnown &&
                scoped.All(x => x.Order is null || x.Order.StatusAtUtc <= at);
            var completeOrders = knownOrders && orders!.OpenOrdersComplete;
            var freshQuantity = p.Valid && !observation.HistoryGap && p.LastFill <= at;
            var resting = scoped.Where(x => Resting(x.Order)).ToArray();
            var stops = resting.Where(x => x.Link.Role == OrderLinkRole.Stop).ToArray();
            var targets = resting.Where(x => x.Link.Role == OrderLinkRole.Target).ToArray();
            var wholeStop = stops.Any(x => x.Order!.IsPositionTpsl);
            var wholeTarget = targets.Any(x => x.Order!.IsPositionTpsl);
            var stopQuantity = stops.Where(x => !x.Order!.IsPositionTpsl).Aggregate(default(ExactAmount), (sum, x) => sum + ExactAmount.From(x.Order!.RemainingSize));
            var targetQuantity = targets.Where(x => !x.Order!.IsPositionTpsl).Aggregate(default(ExactAmount), (sum, x) => sum + ExactAmount.From(x.Order!.RemainingSize));
            var open = play.Status == PlayStatus.Open;
            var terminal = play.Status is PlayStatus.Closed or PlayStatus.Cancelled;
            var stopPresenceKnown = completeOrders && freshQuantity;
            var stopQuantityKnown = stopPresenceKnown && !wholeStop;
            var targetQuantityKnown = completeOrders && freshQuantity && !wholeTarget;
            var details = new { playIds = new[] { play.Id }, nativeContractId = Native(p.Instrument), quantity = p.Valid ? p.Quantity.ToString() : null,
                stopQuantity = stopQuantity.ToString(), targetQuantity = targetQuantity.ToString(),
                orders = scoped.Where(x => x.Link.Role is OrderLinkRole.Stop or OrderLinkRole.Target).Select(x => new { orderId = x.Link.OrderId, role = x.Link.Role.ToString(), level = x.Link.LevelKey,
                    status = x.Order?.Status.ToString(), resting = Resting(x.Order),
                    remainingQuantity = x.Order is null ? null : ExactAmount.From(x.Order.RemainingSize).ToString(),
                    wholePosition = x.Order?.IsPositionTpsl, price = x.Order is null ? null : ExactAmount.From(x.Order.ActingPrice).ToString() }).ToArray() };
            void Add(string kind, bool? present, object? data = null) => scan.Add(new(kind, "play:" + play.Id, play.Id, p.Instrument.ContractId,
                Native(p.Instrument), Severity(kind), present, at, [play.Id], data ?? details));
            var graceAt = p.FirstEntry + options.ProtectionGrace;
            if (open && graceAt > at) scan.Next = Earlier(scan.Next, graceAt.Value);
            Add("protection.missing", !open ? completeOrders ? false : null : stopPresenceKnown ? stops.Length == 0 && graceAt <= at : null);
            Add("protection.short", !open ? completeOrders ? false : null : stopQuantityKnown ? stops.Length > 0 && Compare(stopQuantity, p.Quantity, p.Instrument) < 0 : null);
            var excess = Compare(stopQuantity, p.Quantity, p.Instrument) > 0 || Compare(targetQuantity, p.Quantity, p.Instrument) > 0;
            Add("protection.excess", !open ? completeOrders ? false : null :
                knownOrders && freshQuantity && excess ? true : stopQuantityKnown && targetQuantityKnown ? false : null);
            var cancelled = scoped.Where(x => x.Link.Role == OrderLinkRole.Stop && x.Order?.Status == VenueOrderStatus.Canceled).ToArray();
            var cancelKnown = cancelled.All(x => p.Fills.Any(f => f.Fill.OrderId == x.Link.OrderId) ||
                x.Order!.OriginalSize > 0 && x.Order.RemainingSize == x.Order.OriginalSize);
            Add("protection.cancelled", completeOrders && (!open || stopQuantityKnown && cancelKnown) ? open && cancelled.Any(x =>
                !p.Fills.Any(f => f.Fill.OrderId == x.Link.OrderId)) && Compare(stopQuantity, p.Quantity, p.Instrument) < 0 : null);
            // Orphan checks do not depend on lifetime fills or Play execution settlement.
            Add("protection.orphaned", knownOrders && terminal && play.EndedAtUtc <= at && stops.Length + targets.Length > 0 ? true :
                completeOrders && (!terminal || play.EndedAtUtc <= at) ? false : null);
            var levels = ExecutionMatcher.Levels(p.Plan).ToDictionary(x => x.Key);
            var priced = resting.Where(x => x.Link.Role != OrderLinkRole.Exit).ToArray();
            var pricesKnown = priced.All(x => levels.TryGetValue(x.Link.LevelKey, out var level) && level.Price is not null);
            var driftDetails = new { coverage = details, levels = priced.Select(x => new { orderId = x.Link.OrderId,
                actualPrice = ExactAmount.From(x.Order!.ActingPrice).ToString(),
                plannedPrice = levels.TryGetValue(x.Link.LevelKey, out var level) && level.Price is { } price ? ExactAmount.From(price).ToString() : null }).ToArray() };
            var drift = pricesKnown && priced.Any(x => !ExecutionMatcher.Near(x.Order!.ActingPrice,
                levels[x.Link.LevelKey].Price!.Value, p.Instrument.PriceStep));
            Add("level.drift", knownOrders && drift ? true : completeOrders && pricesKnown ? false : null, driftDetails);
        }
    }

    private static string Native(VenueInstrument i) => i.VenueContractId ?? i.ContractId;
    private static VenueOrder? RetainedOrder(ImportedOrder? order) => order is null ? null : new(order.OrderId, order.ContractId,
        order.Side, order.OrderType, order.LimitPrice, order.TriggerPrice, order.ReduceOnly, order.IsPositionTpsl, order.OriginalSize,
        order.RemainingSize, order.PlacedAtUtc, Enum.TryParse<VenueOrderStatus>(order.Status, true, out var status) ? status : VenueOrderStatus.Other,
        order.VenueStatus, order.StatusAtUtc, order.VenueContractId);
    private static string Subject(VenueInstrument i) => JsonSerializer.Serialize(new[] { i.ContractId, Native(i) });
    private static bool Same(VenueInstrument i, string contract, string? native) => i.ContractId == contract && Native(i) == (native ?? contract);
    private static string Severity(string kind) => kind is "protection.missing" or "protection.cancelled" or "position.missing" or "position.opposite" ? "critical" : kind == "level.drift" ? "info" : "warning";
    private static int Compare(ExactAmount a, ExactAmount b, VenueInstrument i) => Rounded(a, i.QuantityDecimals).CompareTo(Rounded(b, i.QuantityDecimals));
    private static BigInteger Rounded(ExactAmount value, int decimals)
    {
        if (decimals is < 0 or > 28) return value.Units;
        var step = BigInteger.Pow(10, 28 - decimals);
        return (value.Units + value.Units.Sign * (step / 2)) / step;
    }
}
