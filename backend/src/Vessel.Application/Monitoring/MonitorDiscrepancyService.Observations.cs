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
    private static readonly string[] PlayKinds = ["protection.missing", "protection.cancelled", "protection.short", "protection.excess",
        "protection.orphaned", "entry.orphaned", "level.drift"];
    private static readonly string[] PositionKinds = ["position.missing", "position.opposite", "position.short", "position.excess", "fill.unlinked"];
    /// <summary>Unlinked fills listed in details. The count, total and fingerprint always cover all of them.</summary>
    internal const int MaxListedFills = 20;
    /// <summary>Open Plays listed in instrument-level details. Their count, the fingerprint and InvolvedPlayIds cover all.</summary>
    internal const int MaxListedPlays = 50;

    /// <param name="Identity">What the fingerprint covers: the quantities and orders involved. Null means the details.</param>
    /// <param name="Structural">An unknown that is undecidable by design (shared whole-position coverage, an order whose
    /// level has no planned price), not missing or stale evidence. It neither confirms nor resolves and does not degrade the run.</param>
    private sealed record Finding(string Kind, string Subject, Guid? PlayId, string Contract, string Native, string Severity,
        bool? Present, DateTimeOffset At, Guid[] PlayIds, object Details, object? Identity = null, bool Structural = false);
    private sealed class Scan
    {
        public List<Finding> Findings { get; } = [];
        public bool Incomplete { get; set; }
        public DateTimeOffset? Next { get; set; }
        public void Add(Finding finding) { Findings.Add(finding); Incomplete |= finding.Present is null && !finding.Structural; }
    }
    private sealed record PlayFacts(Play Play, PlayPlanDocument Plan, VenueInstrument Instrument,
        PlayOrderLink[] Links, LinkedFill[] Fills, ExactAmount Quantity, DateTimeOffset? FirstEntry,
        DateTimeOffset? LastFill, bool Valid);
    /// <param name="Agrees">Whether the venue position equals the Open Plays' expected total; null without fresh, consistent evidence.</param>
    /// <param name="WholeStops">Open Plays with a resting linked whole-position stop, by the stop's closing side.</param>
    /// <param name="Opposing">Open Plays in both directions net out, so a position match cannot allocate shared coverage.</param>
    /// <param name="UncertainStops">Open Plays with a resting linked whole-position order whose trigger mechanics are unrecognized.</param>
    private sealed record PositionFacts(PlayFacts[] Open, bool? Agrees, IReadOnlyDictionary<string, HashSet<Guid>> WholeStops, bool Opposing,
        IReadOnlyDictionary<string, HashSet<Guid>> UncertainStops);

    private Scan Observe(MonitorEvaluation observation, MonitorDiscrepancyFacts facts, DateTimeOffset now)
    {
        var scan = new Scan { Incomplete = observation.HistoryGap || !facts.Complete };
        if (!facts.Complete) return scan;
        var sync = observation.Read.Sync;
        var orders = observation.Read.Orders;
        var snapshotAt = sync.Snapshot.ObservedAtUtc;
        var at = orders?.ObservedAtUtc ?? snapshotAt;
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
        var fillsByOrder = retainedFills.ToLookup(x => x.OrderId, StringComparer.Ordinal);
        var fillsByContract = retainedFills.ToLookup(x => x.ContractId, StringComparer.Ordinal);
        var retainedOrders = facts.Orders.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id)
            .ToLookup(x => x.OrderId, StringComparer.Ordinal);
        var linked = allLinks.Where(x => x.State == OrderLinkState.Linked).ToArray();
        var linksByPlay = linked.ToLookup(x => x.PlayId);
        var shared = linked.GroupBy(x => x.OrderId).Where(g => g.Count() != 1).Select(x => x.Key).ToHashSet();
        var instrumentsByContract = sync.Instruments.ToLookup(x => x.ContractId, StringComparer.Ordinal);
        var truncatedFills = facts.TruncatedFillContracts ?? new HashSet<string>();
        // Bounded history falling out of the read does not erase an already retained cancellation.
        // Only rows actually in this current read can establish a resting order.
        VenueOrder? Order(string id) => currentOrders.GetValueOrDefault(id) ?? RetainedOrder(retainedOrders[id].SingleOrDefault());
        bool Resting(VenueOrder? order) => order is { Status: VenueOrderStatus.Open } &&
            currentOrders.ContainsKey(order.OrderId) && order.StatusAtUtc == at;

        var plays = new List<PlayFacts>();
        foreach (var play in facts.Plays.Where(x => x.OwnerId == owner.OwnerId && x.AccountId == observation.Account.Id &&
                     x.InstrumentSource == InstrumentSource.Venue && x.Origin == PlayOrigin.Planned && x.Status != PlayStatus.Draft))
        {
            var instruments = play.ContractId is null ? [] : instrumentsByContract[play.ContractId].ToArray();
            if (instruments.Length != 1 || instruments[0].QuantityDecimals is < 0 or > 28)
            {
                foreach (var kind in PlayKinds) scan.Add(new(kind, "play:" + play.Id, play.Id, play.ContractId ?? "", "", Severity(kind), null, snapshotAt, [play.Id], new { }));
                continue;
            }
            var instrument = instruments[0];
            var plan = PlayDocuments.Read(play.Plan);
            var links = linksByPlay[play.Id].OrderBy(x => x.OrderId, StringComparer.Ordinal).ToArray();
            var linkMap = links.GroupBy(x => x.OrderId).ToDictionary(x => x.Key, x => x.First());
            var fills = linkMap.Values.SelectMany(l => fillsByOrder[l.OrderId].Select(f => new LinkedFill(l.Role, f))).ToArray();
            var fillsOf = fills.ToLookup(x => x.Fill.OrderId, x => x.Fill, StringComparer.Ordinal);
            var knownOrders = linkMap.Keys.SelectMany(id => retainedOrders[id]).ToArray();
            var missing = knownOrders.Where(x => ExecutionIntegrity.MissingExecutions(x, fillsOf[x.OrderId])).Select(x => x.OrderId);
            var valid = !links.Any(x => shared.Contains(x.OrderId)) &&
                fills.All(x => Same(instrument, x.Fill.ContractId, x.Fill.VenueContractId) && x.Fill.Quantity > 0 && ExecutionFacts.IsSide(x.Fill.Side)) &&
                knownOrders.All(x => Same(instrument, x.ContractId, x.VenueContractId) &&
                    ExecutionIntegrity.RoleConflict(linkMap[x.OrderId].Role, plan, x, fillsOf[x.OrderId]) is null) &&
                ExecutionIntegrity.Problems(ExecutionIntegrity.EntrySide(plan), fills, missing).Count == 0;
            var counted = fills.Where(x => !ExecutionIntegrity.Contradicts(x.Role, ExecutionIntegrity.EntrySide(plan), x.Fill)).ToArray();
            var entered = counted.Where(x => x.Role == OrderLinkRole.Entry).ToArray();
            var quantity = ExecutionIntegrity.Quantity(entered.Select(x => x.Fill)) - ExecutionIntegrity.Quantity(counted.Where(x => x.Role != OrderLinkRole.Entry).Select(x => x.Fill));
            if (play.Status == PlayStatus.Open && (entered.Length == 0 || quantity.Units.Sign <= 0)) valid = false;
            plays.Add(new(play, plan, instrument, links, fills, quantity,
                entered.Length == 0 ? null : entered.Min(x => x.Fill.OccurredAtUtc),
                fills.Length == 0 ? null : fills.Max(x => x.Fill.OccurredAtUtc), valid));
        }

        // Include instruments without open Plays: a nonzero venue position is untracked exposure.
        var playsByContract = plays.ToLookup(x => x.Instrument.ContractId, StringComparer.Ordinal);
        var positionsByContract = sync.Snapshot.Positions.ToLookup(x => x.ContractId, StringComparer.Ordinal);
        var comparisons = new Dictionary<string, PositionFacts>(StringComparer.Ordinal);
        foreach (var instrumentGroup in sync.Instruments.GroupBy(x => x.ContractId))
        {
            if (instrumentGroup.Count() != 1) { scan.Incomplete = true; continue; }
            var instrument = instrumentGroup.Single();
            var onInstrument = playsByContract[instrument.ContractId].ToArray();
            var involved = onInstrument.Where(x => x.Play.Status == PlayStatus.Open).OrderBy(x => x.Play.Id).ToArray();
            var ids = involved.Select(x => x.Play.Id).ToArray();
            var positions = positionsByContract[instrument.ContractId].ToArray();
            // A Play that closed after the snapshot (now terminal, so not expected) can still be in the venue position.
            var valid = positionsFresh && !observation.HistoryGap && instrument.QuantityDecimals is >= 0 and <= 28 &&
                involved.All(x => x.Valid && x.LastFill <= snapshotAt) && onInstrument.All(x => !(x.LastFill > snapshotAt)) &&
                positions.Length <= 1 && positions.All(x => Same(instrument, x.ContractId, x.VenueContractId));
            var expected = involved.Aggregate(default(ExactAmount), (sum, p) => sum + (p.Plan.Direction == "long" ? p.Quantity : -p.Quantity));
            var actual = positions.Aggregate(default(ExactAmount), (sum, p) => sum + ExactAmount.From(p.SignedQuantity));
            var expectedUnits = Rounded(expected, instrument.QuantityDecimals);
            var actualUnits = Rounded(actual, instrument.QuantityDecimals);
            Dictionary<string, HashSet<Guid>> BySide(OrderMechanism mechanism) => involved
                .SelectMany(x => WholeStopSides(x, mechanism).Select(side => (Side: side, x.Play.Id))).GroupBy(x => x.Side, StringComparer.Ordinal)
                .ToDictionary(x => x.Key, x => x.Select(y => y.Id).ToHashSet(), StringComparer.Ordinal);
            comparisons[instrument.ContractId] = new(involved, valid ? actualUnits == expectedUnits : null, BySide(OrderMechanism.Stop),
                involved.Select(x => x.Plan.Direction).Distinct().Count() > 1, BySide(OrderMechanism.UnknownTrigger));
            var kind = actualUnits == expectedUnits ? null : actualUnits.IsZero && !expectedUnits.IsZero ? "position.missing" :
                !expectedUnits.IsZero && actualUnits.Sign != expectedUnits.Sign ? "position.opposite" :
                BigInteger.Abs(actualUnits) < BigInteger.Abs(expectedUnits) ? "position.short" : "position.excess";
            object Details(int limit) => new { playIds = ids.Take(limit).ToArray(), playCount = ids.Length, nativeContractId = Native(instrument),
                expectedQuantity = expected.ToString(), venueQuantity = actual.ToString(),
                plays = involved.Take(limit).Select(x => new { playId = x.Play.Id, direction = x.Plan.Direction, quantity = x.Quantity.ToString(),
                    orders = x.Fills.GroupBy(f => (f.Fill.OrderId, f.Role)).OrderBy(g => g.Key.OrderId, StringComparer.Ordinal)
                        .Select(g => new { orderId = g.Key.OrderId, role = g.Key.Role.ToString(),
                            quantity = ExecutionIntegrity.Quantity(g.Select(f => f.Fill)).ToString() }).ToArray() }).ToArray() };
            // Displayed Plays are bounded; the fingerprint covers all of them. InvolvedPlayIds keeps the complete list.
            var details = Details(MaxListedPlays);
            var identity = Details(int.MaxValue);
            foreach (var type in PositionKinds.Where(x => x != "fill.unlinked"))
                scan.Add(new(type, Subject(instrument), null, instrument.ContractId, Native(instrument), Severity(type), valid ? type == kind : null, snapshotAt, ids, details, identity));
            var earliest = involved.Where(x => x.FirstEntry is not null).Select(x => x.FirstEntry!.Value).DefaultIfEmpty(DateTimeOffset.MaxValue).Min();
            var after = fillsByContract[instrument.ContractId].Where(x => x.OccurredAtUtc > earliest && !assigned.Contains(x.OrderId)).ToArray();
            var unlinked = after.Where(x => Same(instrument, x.ContractId, x.VenueContractId)).OrderBy(x => x.SourceFillId, StringComparer.Ordinal).ToArray();
            // A retained positive fact remains unlinked even after leaving the bounded recent venue window.
            // Linking/suggestion is local evidence of resolution; absence from recent fills never is.
            var ambiguousFills = after.Length != unlinked.Length;
            var fillKnown = assignmentsComplete && Fresh(snapshotAt) && !observation.HistoryGap && !ambiguousFills && involved.All(x => x.Valid) &&
                !truncatedFills.Contains(instrument.ContractId) && unlinked.All(x => x.OccurredAtUtc <= snapshotAt);
            // Details stay bounded for any number of fills; the fingerprint still covers every fill ID.
            scan.Add(new("fill.unlinked", Subject(instrument), null, instrument.ContractId, Native(instrument), "warning", fillKnown ? unlinked.Length > 0 : null,
                snapshotAt, ids, new { playIds = ids.Take(MaxListedPlays).ToArray(), playCount = ids.Length, nativeContractId = Native(instrument), count = unlinked.Length,
                    totalQuantity = ExecutionIntegrity.Quantity(unlinked).ToString(), fills = unlinked.Take(MaxListedFills).Select(x => new {
                        fillId = x.SourceFillId, orderId = x.OrderId, side = x.Side, quantity = ExactAmount.From(x.Quantity).ToString() }).ToArray() },
                new { fillIds = unlinked.Select(x => x.SourceFillId).ToArray() }));
        }
        foreach (var play in plays) ObservePlay(play, comparisons.GetValueOrDefault(play.Instrument.ContractId));
        // Unknown native products cannot be silently counted under a canonical alias.
        if (sync.Snapshot.Positions.Any(p => !sync.Instruments.Any(i => Same(i, p.ContractId, p.VenueContractId)))) scan.Incomplete = true;
        return scan;

        // Only an actual linked stop on this account and native contract; a whole-position target, or a take-profit
        // linked with the Stop role, never protects.
        IEnumerable<string> WholeStopSides(PlayFacts p, OrderMechanism mechanism) => p.Links.Where(l => l.Role == OrderLinkRole.Stop)
            .Select(l => Order(l.OrderId)).Where(order => order is { IsPositionTpsl: true } && Resting(order) &&
                Same(p.Instrument, order.ContractId, order.VenueContractId) && OrderMechanics.Classify(order) == mechanism)
            .Select(order => order!.Side).Distinct(StringComparer.Ordinal);

        void ObservePlay(PlayFacts p, PositionFacts? position)
        {
            var play = p.Play;
            var scoped = p.Links.Select(l => (Link: l, Order: Order(l.OrderId))).ToArray();
            var identityKnown = scoped.All(x => x.Order is null || Same(p.Instrument, x.Order.ContractId, x.Order.VenueContractId));
            var knownOrders = ordersFresh && !duplicateOrders && identityKnown &&
                scoped.All(x => x.Order is null || x.Order.StatusAtUtc <= at);
            var completeOrders = knownOrders && orders!.OpenOrdersComplete;
            var freshQuantity = p.Valid && !observation.HistoryGap && p.LastFill <= at;
            var resting = scoped.Where(x => Resting(x.Order)).ToArray();
            // A stop on the entry side closes nothing of this exposure: a sell stop covers a long, a buy stop a short.
            var exitSide = ExecutionMatcher.ExitSide(p.Plan);
            var stopRows = resting.Where(x => x.Link.Role == OrderLinkRole.Stop && x.Order!.Side == exitSide).ToArray();
            // Only stop mechanics protect: a take-profit or plain limit linked as a stop does not. Unrecognized trigger
            // mechanics never establish coverage either; they leave it unknown rather than protected.
            var stops = stopRows.Where(x => OrderMechanics.Classify(x.Order!) == OrderMechanism.Stop).ToArray();
            var ownMechanicsKnown = stopRows.All(x => OrderMechanics.Classify(x.Order!) != OrderMechanism.UnknownTrigger);
            var targets = resting.Where(x => x.Link.Role == OrderLinkRole.Target).ToArray();
            var entries = resting.Where(x => x.Link.Role == OrderLinkRole.Entry).ToArray();
            var open = play.Status == PlayStatus.Open;
            var terminal = play.Status is PlayStatus.Closed or PlayStatus.Cancelled;
            var involved = position?.Open ?? [];
            var single = open && involved.Length == 1 && involved[0].Play.Id == play.Id;
            var agrees = position?.Agrees;
            // A resting whole-position stop on the same closing side covers every Open Play of that direction on the
            // instrument. Its quantity is the venue position, so it establishes this Play's coverage only when this is the
            // instrument's only Open Play and the position matches. Another Play's stop covers this one only when the
            // position matches and no opposing Plays net out (net equality never allocates per-Play protection).
            // Otherwise coverage is undecidable by design, unless the position evidence itself is missing.
            var ownWholeStop = stops.Any(x => x.Order!.IsPositionTpsl);
            var ownWholeTarget = targets.Any(x => x.Order!.IsPositionTpsl);
            var sharers = position?.WholeStops.GetValueOrDefault(exitSide);
            var siblingWholeStop = open && sharers is not null && sharers.Count > (sharers.Contains(play.Id) ? 1 : 0);
            var uncertain = position?.UncertainStops.GetValueOrDefault(exitSide);
            var mechanicsKnown = ownMechanicsKnown && !(open && uncertain is not null && uncertain.Count > (uncertain.Contains(play.Id) ? 1 : 0));
            var shared = siblingWholeStop && position!.Opposing is false && agrees == true;
            var established = single && agrees == true;
            var structural = agrees is not null;
            var stopCoverageKnown = (ownWholeStop ? established : !siblingWholeStop) && mechanicsKnown;
            var stopExcessKnown = (!ownWholeStop || established) && ownMechanicsKnown;
            var targetCoverageKnown = !ownWholeTarget || established;
            // Reduce-only orders cannot exceed the only Open Play's position (e.g. a stop left at full size after a
            // partial target). With other Open Plays on the instrument they could close those, so they still count.
            ExactAmount Covered(IEnumerable<(PlayOrderLink Link, VenueOrder? Order)> rows, bool whole, bool excess) =>
                rows.Where(x => !x.Order!.IsPositionTpsl && !(excess && single && x.Order.ReduceOnly))
                    .Aggregate(whole && established ? p.Quantity : default, (sum, x) => sum + ExactAmount.From(x.Order!.RemainingSize));
            var stopQuantity = Covered(stops, ownWholeStop, false);
            var stopPresenceKnown = completeOrders && freshQuantity;
            var stopQuantityKnown = stopPresenceKnown && stopCoverageKnown;
            var details = new { playIds = new[] { play.Id }, nativeContractId = Native(p.Instrument), quantity = p.Valid ? p.Quantity.ToString() : null,
                stopQuantity = Covered(stops, false, false).ToString(), targetQuantity = Covered(targets, false, false).ToString(),
                stopCoverage = ownWholeStop || siblingWholeStop ? stopCoverageKnown ? "whole-position" : "unknown" : "orders",
                orders = scoped.Where(x => x.Link.Role is OrderLinkRole.Stop or OrderLinkRole.Target).Select(x => new { orderId = x.Link.OrderId, role = x.Link.Role.ToString(), level = x.Link.LevelKey,
                    status = x.Order?.Status.ToString(), resting = Resting(x.Order),
                    remainingQuantity = x.Order is null ? null : ExactAmount.From(x.Order.RemainingSize).ToString(),
                    wholePosition = x.Order?.IsPositionTpsl, price = x.Order is null ? null : ExactAmount.From(x.Order.ActingPrice).ToString() }).ToArray() };
            // The fingerprint covers the quantities and orders involved, not prices or display fields.
            object Identity(OrderLinkRole[] roles) => new { quantity = details.quantity, orders = scoped.Where(x => roles.Contains(x.Link.Role))
                .Select(x => new { orderId = x.Link.OrderId, role = x.Link.Role.ToString(), status = x.Order?.Status.ToString(), resting = Resting(x.Order),
                    remainingQuantity = x.Order is null ? null : ExactAmount.From(x.Order.RemainingSize).ToString(), wholePosition = x.Order?.IsPositionTpsl }).ToArray() };
            var protection = Identity([OrderLinkRole.Stop, OrderLinkRole.Target]);
            void Add(string kind, bool? present, bool undecidable = false, object? data = null, object? identity = null) => scan.Add(new(kind, "play:" + play.Id, play.Id,
                p.Instrument.ContractId, Native(p.Instrument), Severity(kind), present, at, [play.Id], data ?? details, identity ?? protection,
                present is null && undecidable));
            var graceAt = p.FirstEntry + options.ProtectionGrace;
            if (open && graceAt > at) scan.Next = Earlier(scan.Next, graceAt.Value);

            var cancelled = scoped.Where(x => x.Link.Role == OrderLinkRole.Stop && x.Order?.Status == VenueOrderStatus.Canceled).ToArray();
            var filled = p.Fills.Select(x => x.Fill.OrderId).ToHashSet(StringComparer.Ordinal);
            var cancelKnown = cancelled.All(x => filled.Contains(x.Link.OrderId) ||
                x.Order!.OriginalSize > 0 && x.Order.RemainingSize == x.Order.OriginalSize);
            bool? cancelledPresent = !open ? completeOrders ? false : null : !stopPresenceKnown ? null :
                cancelled.All(x => filled.Contains(x.Link.OrderId)) ? false : !cancelKnown || !stopCoverageKnown ? null :
                Compare(stopQuantity, p.Quantity, p.Instrument) < 0;
            // A cancelled stop explains the same gap; it supersedes missing and short protection.
            var superseded = cancelledPresent == true;
            Add("protection.cancelled", cancelledPresent, stopPresenceKnown && cancelKnown && mechanicsKnown && structural);
            bool? missing = !open ? completeOrders ? false : null : !stopPresenceKnown ? null : superseded || stops.Length > 0 ? false :
                !mechanicsKnown ? null : siblingWholeStop ? shared ? false : null : graceAt <= at;
            Add("protection.missing", missing, stopPresenceKnown && mechanicsKnown && structural);
            Add("protection.short", !open ? completeOrders ? false : null : !stopPresenceKnown ? null :
                superseded || stops.Length == 0 ? false : stopCoverageKnown ? Compare(stopQuantity, p.Quantity, p.Instrument) < 0 : null,
                stopPresenceKnown && mechanicsKnown && structural);
            var excess = Compare(Covered(stops, ownWholeStop, true), p.Quantity, p.Instrument) > 0 ||
                Compare(Covered(targets, ownWholeTarget, true), p.Quantity, p.Instrument) > 0;
            Add("protection.excess", !open ? completeOrders ? false : null :
                knownOrders && freshQuantity && excess ? true : stopPresenceKnown && stopExcessKnown && targetCoverageKnown ? false : null,
                stopPresenceKnown && ownMechanicsKnown && structural);
            // Orphan checks do not depend on lifetime fills or Play execution settlement.
            // Any resting linked exit can close another Play's position, whatever its side or mechanics.
            Add("protection.orphaned", knownOrders && terminal && play.EndedAtUtc <= at && resting.Any(x => x.Link.Role is OrderLinkRole.Stop or OrderLinkRole.Target) ? true :
                completeOrders && (!terminal || play.EndedAtUtc <= at) ? false : null);
            var entryDetails = new { playIds = new[] { play.Id }, nativeContractId = Native(p.Instrument),
                orders = scoped.Where(x => x.Link.Role == OrderLinkRole.Entry).Select(x => new { orderId = x.Link.OrderId, level = x.Link.LevelKey,
                    status = x.Order?.Status.ToString(), resting = Resting(x.Order),
                    remainingQuantity = x.Order is null ? null : ExactAmount.From(x.Order.RemainingSize).ToString(),
                    price = x.Order is null ? null : ExactAmount.From(x.Order.ActingPrice).ToString() }).ToArray() };
            Add("entry.orphaned", knownOrders && terminal && play.EndedAtUtc <= at && entries.Length > 0 ? true :
                completeOrders && (!terminal || play.EndedAtUtc <= at) ? false : null, data: entryDetails, identity: Identity([OrderLinkRole.Entry]));

            // Drift is decided per order: any priced order that drifted is enough. An order whose level has no
            // planned price (e.g. removed by a revision) cannot be decided, by design.
            var levels = ExecutionMatcher.Levels(p.Plan).ToDictionary(x => x.Key);
            var priced = resting.Where(x => x.Link.Role != OrderLinkRole.Exit).Select(x => (x.Link, Order: x.Order!,
                Planned: levels.TryGetValue(x.Link.LevelKey, out var level) ? level.Price : null)).ToArray();
            var levelRows = priced.Select(x => new { orderId = x.Link.OrderId, actualPrice = ExactAmount.From(x.Order.ActingPrice).ToString(),
                plannedPrice = x.Planned is { } price ? ExactAmount.From(price).ToString() : null,
                remainingQuantity = ExactAmount.From(x.Order.RemainingSize).ToString() }).ToArray();
            var drift = priced.Any(x => x.Planned is { } price && !ExecutionMatcher.Near(x.Order.ActingPrice, price, p.Instrument.PriceStep));
            var undecided = priced.Any(x => x.Planned is null);
            Add("level.drift", knownOrders && drift ? true : completeOrders && !undecided ? false : null, completeOrders && undecided,
                // A partial close changes the quantities involved, so a dismissed drift re-arms.
                new { coverage = details, levels = levelRows }, new { quantity = details.quantity, levels = levelRows });
        }
    }

    private static string Native(VenueInstrument i) => i.VenueContractId ?? i.ContractId;
    private static VenueOrder? RetainedOrder(ImportedOrder? order) => order is null ? null : new(order.OrderId, order.ContractId,
        order.Side, order.OrderType, order.LimitPrice, order.TriggerPrice, order.ReduceOnly, order.IsPositionTpsl, order.OriginalSize,
        order.RemainingSize, order.PlacedAtUtc, Enum.TryParse<VenueOrderStatus>(order.Status, true, out var status) ? status : VenueOrderStatus.Other,
        order.VenueStatus, order.StatusAtUtc, order.VenueContractId);
    private static string Subject(VenueInstrument i) => JsonSerializer.Serialize(new[] { i.ContractId, Native(i) });
    private static bool Same(VenueInstrument i, string contract, string? native) => i.ContractId == contract && Native(i) == (native ?? contract);
    private static string Severity(string kind) => kind is "protection.missing" or "protection.cancelled" or "entry.orphaned" or
        "position.missing" or "position.opposite" ? "critical" : kind == "level.drift" ? "info" : "warning";
    private static int Compare(ExactAmount a, ExactAmount b, VenueInstrument i) => Rounded(a, i.QuantityDecimals).CompareTo(Rounded(b, i.QuantityDecimals));
    private static BigInteger Rounded(ExactAmount value, int decimals)
    {
        if (decimals is < 0 or > 28) return value.Units;
        var step = BigInteger.Pow(10, 28 - decimals);
        return (value.Units + value.Units.Sign * (step / 2)) / step;
    }
}
