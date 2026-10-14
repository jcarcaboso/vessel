using System.Globalization;
using System.Numerics;
using Vessel.Application.Activity;
using Vessel.Application.Common;
using Vessel.Application.Sizing;
using Vessel.Application.Venues;
using Vessel.Application.Credentials;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Plays.Execution;

/// <summary>
/// Links venue orders to Play levels and moves Plays between Planned, Open and Closed from linked fills.
/// Unambiguous orders link automatically; ambiguous ones become suggestions for the owner. Read-only at the venue.
/// </summary>
public sealed class PlayExecutionService(IPlayStore plays, IPlayExecutionStore store, WorkspaceService workspace,
    IVenueRegistry venues, TimeProvider time, IAccountCredentialReader? credentials = null)
{
    private const int MaxUnlinkedOrders = 20;
    private const string Notice = "Orders and fills come from the venue and link to this play by order ID. " +
        "Price touches are never treated as fills. Quantities are base units from linked fills; closed PnL and fees are as the venue reports them.";

    /// <summary>Retains bounded venue order history on explicit account refresh, without linking orders or changing Plays.</summary>
    public Task<string?> RetainAccountOrdersAsync(Guid accountId, CancellationToken ct) =>
        workspace.WithAccountLockAsync<string?>(accountId, async account =>
        {
            var notice = await RetainAccountOrdersLockedAsync(account, ct);
            await workspace.RecordOrderHistoryNoticeAsync(account, notice, ct);
            return notice;
        }, ct);

    private async Task<string?> RetainAccountOrdersLockedAsync(Account account, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!account.IsEnabled) throw new ProblemException(400, "Enable the account before refreshing it.");
        if (venues.Descriptor(account.VenueId) is not { Capabilities.Orders: true })
            return "This venue does not provide order history; execution completeness cannot be checked.";
        if (account.SourceId is null) throw new ProblemException(400, "A source identity is required before refresh.");
        if (venues.Orders(account.VenueId) is not { } reader)
            return "Order history was not refreshed because the venue order reader is unavailable.";
        VenueOrderReadResult read;
        try
        {
            var reason = await CredentialReasonAsync(account, usableOnly: false, ct);
            ct.ThrowIfCancellationRequested();
            if (reason is not null)
                return $"Order history was not refreshed. {reason}";
            read = await reader.ReadOrdersAsync(account, ct);
            if (!read.Orders.All(VenueFactChecks.Valid))
                throw new VenueReadException("The venue adapter returned orders outside Vessel's execution vocabulary.");
        }
        catch (Exception ex) when (ex is VenueReadException or HttpRequestException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            ct.ThrowIfCancellationRequested();
            return "Order history could not be refreshed; execution completeness remains limited to retained order records. Try again later.";
        }
        ct.ThrowIfCancellationRequested();
        await store.WithAccountLockAsync(account.Id, async () =>
        {
            await store.UpsertOrdersAsync(account, read.Orders, read.ObservedAtUtc, ct);
            return true;
        }, ct);
        return read.Notice;
    }


    /// <summary>Refreshes the account's fills and orders, links what matches and applies status changes.</summary>
    public async Task<PlayExecutionDto> CheckAsync(Guid playId, CancellationToken ct)
    {
        var play = await plays.FindAsync(playId, ct) ?? throw new ProblemException(404, "Play not found.");
        var account = await store.AccountAsync(play.AccountId, ct);
        if (UntrackedReason(play, account, account is null ? null : venues.Descriptor(account.VenueId)) is { } reason) throw new ProblemException(409, reason);
        if (venues.Orders(account!.VenueId) is not { } orderReader) throw new ProblemException(503, "Venue reader is unavailable.");
        await workspace.SyncAsync(account.Id, ct);
        await workspace.WithAccountLockAsync(account.Id, async lockedAccount =>
        {
            if (!lockedAccount.IsEnabled) throw new ProblemException(409, "Enable the account to track its orders.");
            if (await CredentialReasonAsync(lockedAccount, usableOnly: false, ct) is { } credentialReason)
                throw new ProblemException(409, credentialReason);
            VenueOrderReadResult read;
            try
            {
                read = await orderReader.ReadOrdersAsync(lockedAccount, ct);
                if (!read.Orders.All(VenueFactChecks.Valid))
                    throw new VenueReadException("The venue adapter returned orders outside Vessel's execution vocabulary.");
            }
            catch (Exception ex) when (ex is VenueReadException or HttpRequestException || ex is OperationCanceledException && !ct.IsCancellationRequested)
            {
                throw new ProblemException(502, "Venue orders could not be read. Try again later.");
            }
            var ticks = await TicksAsync(lockedAccount, ct);
            await store.WithAccountLockAsync(lockedAccount.Id, async () => { await ReconcileAsync(lockedAccount, read, ticks, ct); return true; }, ct);
            await workspace.RecordOrderHistoryNoticeAsync(lockedAccount, read.Notice, ct);
            return true;
        }, ct);
        return await GetAsync(playId, ct);
    }

    public async Task<PlayExecutionDto> GetAsync(Guid playId, CancellationToken ct)
    {
        var play = await plays.FindAsync(playId, ct) ?? throw new ProblemException(404, "Play not found.");
        var account = await store.AccountAsync(play.AccountId, ct);
        var links = (await store.LinksAsync(play.AccountId, ct)).Where(l => l.State != OrderLinkState.Dismissed).ToList();
        var orders = (await store.OrdersAsync(play.AccountId, ct)).ToDictionary(o => o.OrderId, StringComparer.Ordinal);
        var linkedOrders = links.Where(l => l.State == OrderLinkState.Linked).Select(l => l.OrderId).ToHashSet(StringComparer.Ordinal);
        var mine = links.Where(l => l.PlayId == play.Id).ToList();
        var fills = (await store.FillsAsync(play.AccountId, mine.Select(l => l.OrderId).Distinct().ToList(), ct)).ToLookup(f => f.OrderId);
        var linked = mine.Where(l => l.State == OrderLinkState.Linked)
            .OrderBy(l => l.Role).ThenBy(l => l.EntryId).ThenBy(l => l.LevelId).ThenBy(l => l.OrderId).ToList();
        var suggestions = mine.Where(l => l.State == OrderLinkState.Suggested && !linkedOrders.Contains(l.OrderId)).ToList();
        // Cancelled orders that never filled cannot be part of the play, so only live or filled ones are offered.
        var unlinked = play.ContractId is null ? [] : orders.Values
            .Where(o => o.ContractId == play.ContractId && o.PlacedAtUtc >= play.CreatedAtUtc && !linkedOrders.Contains(o.OrderId) &&
                o.Status is "open" or "filled" or "triggered")
            .OrderByDescending(o => o.PlacedAtUtc).Take(MaxUnlinkedOrders).Select(OrderDto).ToList();

        var plan = PlayDocuments.Read(play.Plan);
        var settlement = Settle(plan, linked, orders, fills, play.Origin == PlayOrigin.Retrospective);
        var entered = settlement.Entered;
        var exited = settlement.Exited;
        var open = entered - exited;
        var all = settlement.Counted.Select(f => f.Fill).ToList();
        var totals = new ExecutionTotalsDto(entered.ToString(), exited.ToString(), open.Units.Sign > 0 ? open.ToString() : "0",
            all.Aggregate(default(ExactAmount), (sum, f) => sum + ExactAmount.From(f.ClosedPnlUsd)).ToString(), PnlBasis(all),
            all.GroupBy(f => f.FeeToken).OrderBy(g => g.Key).Select(g => new FeeTotalDto(g.Key,
                g.Aggregate(default(ExactAmount), (sum, f) => sum + ExactAmount.From(f.Fee)).ToString())).ToList());
        var entries = plan.Entries.Select(entry =>
        {
            var own = linked.Where(l => l.Role == OrderLinkRole.Entry && l.EntryId == entry.Id).ToList();
            var filled = own.SelectMany(l => fills[l.OrderId]).Where(f => !ExecutionIntegrity.Contradicts(OrderLinkRole.Entry, settlement.EntrySide, f)).ToList();
            var quantity = ExecutionIntegrity.Quantity(filled);
            var notional = filled.Aggregate(BigInteger.Zero,
                (sum, f) => sum + ExactAmount.From(f.Price).Units * ExactAmount.From(f.Quantity).Units);
            return new EntryProgressDto(entry.Id, quantity.ToString(), quantity.Units.Sign > 0 ? ExactAmount.Average(notional, quantity) : null,
                own.Count(l => orders.TryGetValue(l.OrderId, out var o) && o.Status == "open"));
        }).ToList();
        OrderLinkDto Link(PlayOrderLink link) => new(link.Id, Name(link.Role), link.EntryId, link.LevelId, Name(link.State), Name(link.Source),
            orders.TryGetValue(link.OrderId, out var order) ? OrderDto(order) : null, ExecutionIntegrity.Quantity(fills[link.OrderId]).ToString(),
            fills[link.OrderId].OrderBy(f => f.OccurredAtUtc).Select(FillDto).ToList());
        var reason = UntrackedReason(play, account, account is null ? null : venues.Descriptor(account.VenueId));
        if (reason is null && account is { IsEnabled: true } && play.Status is not (PlayStatus.Closed or PlayStatus.Cancelled))
            reason = await CredentialReasonAsync(account, usableOnly: true, ct);
        return new PlayExecutionDto(play.Id, PlayService.StatusName(play.Status), reason is null, reason, account?.LastSyncedAtUtc,
            totals, entries, linked.Select(Link).ToList(), suggestions.Select(Link).ToList(), unlinked, Notice, settlement.Problems);
    }

    /// <summary>The owner links an order (or confirms a suggestion). It must not belong to another level already.</summary>
    public async Task<PlayExecutionDto> LinkAsync(Guid playId, LinkOrderRequest request, CancellationToken ct)
    {
        var play = await plays.FindAsync(playId, ct) ?? throw new ProblemException(404, "Play not found.");
        if (!ExecutionMatcher.IsActive(play)) throw new ProblemException(409, NotLinkable);
        var role = request.Role switch
        {
            "entry" => OrderLinkRole.Entry, "stop" => OrderLinkRole.Stop, "target" => OrderLinkRole.Target, "exit" => OrderLinkRole.Exit,
            _ => throw new ProblemException(400, "Role must be entry, stop, target or exit.")
        };
        await store.WithAccountLockAsync(play.AccountId, async () =>
        {
            await RequireActiveAsync(play, NotLinkable, ct);
            // The committed plan decides, not the one this request read first.
            var plan = PlayDocuments.Read(play.Plan);
            var entry = role == OrderLinkRole.Exit ? null : plan.Entries.FirstOrDefault(e => e.Id == request.EntryId)
                ?? throw new ProblemException(400, "Choose an entry of this play.");
            var levelId = role switch
            {
                OrderLinkRole.Stop => entry!.Stops.FirstOrDefault(s => s.Id == request.LevelId)?.Id ?? throw new ProblemException(400, "Choose a stop of this entry."),
                OrderLinkRole.Target => entry!.Targets.FirstOrDefault(t => t.Id == request.LevelId)?.Id ?? throw new ProblemException(400, "Choose a target of this entry."),
                _ => null
            };
            var order = (await store.OrdersAsync(play.AccountId, ct)).FirstOrDefault(o => o.OrderId == request.OrderId && o.ContractId == play.ContractId)
                ?? throw new ProblemException(404, "This order is not known for the play's instrument. Check the venue first.");
            var links = await store.LinksAsync(play.AccountId, ct);
            if (links.Any(l => l.OrderId == order.OrderId && l.State == OrderLinkState.Linked))
                throw new ProblemException(409, "This order is already linked. Unlink it first.");
            if (ExecutionIntegrity.RoleConflict(role, plan, order, await store.FillsAsync(play.AccountId, [order.OrderId], ct)) is { } conflict)
                throw new ProblemException(409, conflict);
            var now = time.GetUtcNow();
            var key = PlayOrderLink.Key(role, entry?.Id, levelId);
            var existing = links.FirstOrDefault(l => l.PlayId == play.Id && l.OrderId == order.OrderId && l.LevelKey == key);
            if (existing is not null) existing.Confirm(now);
            else store.Add(new PlayOrderLink(play, order.OrderId, role, entry?.Id, levelId, OrderLinkState.Linked, OrderLinkSource.Owner, now));
            // Other suggestions for this order stay hidden while it is linked and return if it is unlinked.
            await store.SaveAsync(ct);
            await ApplyTransitionsAsync(play.AccountId, [play], ct);
            await store.SaveAsync(ct);
            return true;
        }, ct);
        return await GetAsync(playId, ct);
    }

    /// <summary>
    /// Removes a link or declines a suggestion. It is never proposed for that level again. Closed and Cancelled are
    /// final, so their links stay: removing one would leave a final status its fills no longer support.
    /// </summary>
    public async Task<PlayExecutionDto> UnlinkAsync(Guid playId, Guid linkId, CancellationToken ct)
    {
        var play = await plays.FindAsync(playId, ct) ?? throw new ProblemException(404, "Play not found.");
        await store.WithAccountLockAsync(play.AccountId, async () =>
        {
            var link = (await store.LinksAsync(play.AccountId, ct)).FirstOrDefault(l => l.Id == linkId && l.PlayId == play.Id &&
                l.State != OrderLinkState.Dismissed) ?? throw new ProblemException(404, "Link not found.");
            if (link.State == OrderLinkState.Linked) await RequireActiveAsync(play, "Closed and cancelled plays keep their linked orders.", ct);
            link.Dismiss(time.GetUtcNow());
            await store.SaveAsync(ct);
            return true;
        }, ct);
        return await GetAsync(playId, ct);
    }

    private const string NotLinkable = "Only planned, paused or open plays link orders.";

    /// <summary>
    /// The Play may have closed, been cancelled or revised since this request read it. Membership in the committed
    /// active set decides, under the account lock that fill-driven changes hold; it also reloads the Play and holds it
    /// until the transaction ends, so the owner's status and plan changes wait rather than commit in between.
    /// </summary>
    private async Task RequireActiveAsync(Play play, string message, CancellationToken ct)
    {
        if (!(await store.ActivePlaysAsync(play.AccountId, ct)).Any(p => p.Id == play.Id)) throw new ProblemException(409, message);
    }

    /// <summary>
    /// Price ticks by instrument for venues that round to a tick. Unavailable metadata leaves the five-significant-figure
    /// tolerance in place rather than failing the check.
    /// </summary>
    private async Task<IReadOnlyDictionary<string, decimal>> TicksAsync(Account account, CancellationToken ct)
    {
        if (venues.Descriptor(account.VenueId) is not { PriceRule: PriceRules.TickSize } || venues.Reader(account.VenueId) is not { } reader)
            return new Dictionary<string, decimal>();
        try
        {
            return (await reader.ReadInstrumentsAsync(ct)).Where(i => i.PriceStep is > 0)
                .GroupBy(i => i.ContractId, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().PriceStep!.Value, StringComparer.Ordinal);
        }
        catch (Exception ex) when (ex is VenueReadException or HttpRequestException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new Dictionary<string, decimal>();
        }
    }

    private async Task ReconcileAsync(Account account, VenueOrderReadResult read, IReadOnlyDictionary<string, decimal> ticks, CancellationToken ct)
    {
        var active = (await store.ActivePlaysAsync(account.Id, ct))
            .Where(p => p.InstrumentSource == InstrumentSource.Venue && p.ContractId is not null).ToList();
        if (active.Count == 0) return;
        var since = active.GroupBy(p => p.ContractId!).ToDictionary(g => g.Key, g => g.Min(p => p.CreatedAtUtc), StringComparer.Ordinal);
        await store.UpsertOrdersAsync(account, read.Orders.Where(o => o.Status != VenueOrderStatus.Rejected &&
            since.TryGetValue(o.ContractId, out var from) && o.PlacedAtUtc >= from).ToList(), read.ObservedAtUtc, ct);

        // An entry fill opens a play, which can make its exit orders matchable, so repeat while statuses move.
        for (var pass = 0; pass < 3; pass++)
        {
            var before = active.Select(p => p.Status).ToList();
            await MatchAsync(account, active, ticks, ct);
            await ApplyTransitionsAsync(account.Id, active, ct);
            await store.SaveAsync(ct);
            if (before.SequenceEqual(active.Select(p => p.Status))) break;
        }
    }

    private async Task MatchAsync(Account account, List<Play> active, IReadOnlyDictionary<string, decimal> ticks, CancellationToken ct)
    {
        var orders = await store.OrdersAsync(account.Id, ct);
        var links = await store.LinksAsync(account.Id, ct);
        var fills = (await store.FillsAsync(account.Id, orders.Select(o => o.OrderId).ToList(), ct)).ToLookup(f => f.OrderId);
        var candidatesPlays = active.Select(p => (Play: p, Plan: PlayDocuments.Read(p.Plan))).ToList();
        var firstEntryFill = candidatesPlays.ToDictionary(p => p.Play.Id, p => links
            .Where(l => l.PlayId == p.Play.Id && l.State == OrderLinkState.Linked && l.Role == OrderLinkRole.Entry)
            .SelectMany(l => fills[l.OrderId]).Where(f => !ExecutionIntegrity.Contradicts(OrderLinkRole.Entry, ExecutionIntegrity.EntrySide(p.Plan), f))
            .Select(f => (DateTimeOffset?)f.OccurredAtUtc).Min());
        var now = time.GetUtcNow();
        foreach (var order in orders.OrderBy(o => o.PlacedAtUtc))
        {
            if (order.Status == "rejected") continue;
            if (links.Any(l => l.OrderId == order.OrderId && l.State == OrderLinkState.Linked)) continue;
            // A cancelled order that never filled cannot affect a play.
            if (order.Status == "canceled" && !fills[order.OrderId].Any()) continue;
            var closes = fills[order.OrderId].Any(f => ExecutionFacts.Closes(f.PositionEffect));
            var candidates = ExecutionMatcher.Candidates(order, candidatesPlays,
                (play, key) => links.Any(l => l.PlayId == play.Id && l.OrderId == order.OrderId && l.LevelKey == key && l.State == OrderLinkState.Dismissed),
                closes, play => firstEntryFill.GetValueOrDefault(play.Id),
                ticks.TryGetValue(order.ContractId, out var tick) ? tick : null, fills[order.OrderId].ToList());
            if (candidates.Count == 1)
            {
                var (play, level) = (candidates[0].Play, candidates[0].Level);
                var existing = links.FirstOrDefault(l => l.PlayId == play.Id && l.OrderId == order.OrderId && l.LevelKey == level.Key);
                if (existing is not null) existing.LinkAutomatically(now);
                else
                {
                    var link = new PlayOrderLink(play, order.OrderId, level.Role, level.EntryId, level.LevelId, OrderLinkState.Linked, OrderLinkSource.Automatic, now);
                    store.Add(link);
                    links.Add(link);
                }
                continue;
            }
            foreach (var candidate in candidates)
            {
                if (links.Any(l => l.PlayId == candidate.Play.Id && l.OrderId == order.OrderId && l.LevelKey == candidate.Level.Key)) continue;
                var link = new PlayOrderLink(candidate.Play, order.OrderId, candidate.Level.Role, candidate.Level.EntryId, candidate.Level.LevelId,
                    OrderLinkState.Suggested, OrderLinkSource.Automatic, now);
                store.Add(link);
                links.Add(link);
            }
        }
        await store.SaveAsync(ct);
    }

    /// <summary>
    /// Planned or paused → Open on the first linked entry fill; Open → Closed once linked exits equal the entries and
    /// nothing is known missing, contradictory or out of order. Closed is final, so it waits until the fills settle the play.
    /// </summary>
    private async Task ApplyTransitionsAsync(Guid accountId, IReadOnlyList<Play> targets, CancellationToken ct)
    {
        var links = (await store.LinksAsync(accountId, ct)).Where(l => l.State == OrderLinkState.Linked).ToList();
        var orders = (await store.OrdersAsync(accountId, ct)).ToDictionary(o => o.OrderId, StringComparer.Ordinal);
        var fills = (await store.FillsAsync(accountId, links.Select(l => l.OrderId).Distinct().ToList(), ct)).ToLookup(f => f.OrderId);
        var now = time.GetUtcNow();
        foreach (var play in targets)
        {
            var own = links.Where(l => l.PlayId == play.Id).ToList();
            var settlement = Settle(PlayDocuments.Read(play.Plan), own, orders, fills);
            var entryFills = settlement.Counted.Where(f => f.Role == OrderLinkRole.Entry).Select(f => f.Fill).OrderBy(f => f.OccurredAtUtc).ToList();
            var entered = settlement.Entered;
            if (play.Status is PlayStatus.Planned or PlayStatus.Paused && entered.Units.Sign > 0)
            {
                var first = entryFills[0];
                store.Add(play.MarkOpen($"Entry fill of {Money(first.Quantity)} at {Money(first.Price)} on order {first.OrderId}.", now));
            }
            var resting = own.Any(l => l.Role == OrderLinkRole.Entry && orders.TryGetValue(l.OrderId, out var o) && o.Status == "open");
            if (play.Status == PlayStatus.Open && entered.Units.Sign > 0 && settlement.Exited == entered && settlement.Problems.Count == 0 && !resting)
                store.Add(play.MarkClosed($"Linked exits covered the {entered} entered.", now));
        }
    }

    /// <summary>The linked fills that count for a Play, with the reasons they cannot settle it yet.</summary>
    private sealed record Settlement(string EntrySide, List<LinkedFill> Counted, List<string> Problems)
    {
        public ExactAmount Entered => ExecutionIntegrity.Quantity(Counted.Where(f => f.Role == OrderLinkRole.Entry).Select(f => f.Fill));
        public ExactAmount Exited => ExecutionIntegrity.Quantity(Counted.Where(f => f.Role != OrderLinkRole.Entry).Select(f => f.Fill));
    }

    /// <summary>Fills that contradict their role stay visible on their links but count toward neither side.</summary>
    private static Settlement Settle(PlayPlanDocument plan, IReadOnlyCollection<PlayOrderLink> linked,
        IReadOnlyDictionary<string, ImportedOrder> orders, ILookup<string, ImportedFill> fills, bool retrospective = false)
    {
        var side = ExecutionIntegrity.EntrySide(plan);
        var all = linked.SelectMany(l => fills[l.OrderId].Select(f => new LinkedFill(l.Role, f))).ToList();
        var incomplete = linked.Where(l => orders.TryGetValue(l.OrderId, out var order) &&
            ExecutionIntegrity.MissingExecutions(order, fills[l.OrderId])).Select(l => l.OrderId);
        var problems = ExecutionIntegrity.Problems(side, all, incomplete);
        if (!retrospective)
        {
            var levels = ExecutionMatcher.Levels(plan).Select(l => l.Key).ToHashSet(StringComparer.Ordinal);
            problems.AddRange(linked.Where(l => l.Role != OrderLinkRole.Exit && !levels.Contains(l.LevelKey))
                .Select(l => $"Order {l.OrderId} references a plan entry or level that no longer exists; review its association."));
        }
        return new(side, all.Where(f => !ExecutionIntegrity.Contradicts(f.Role, side, f.Fill)).ToList(), problems);
    }

    /// <summary>Why the play cannot be tracked at the venue, or null when it can.</summary>
    public static string? UntrackedReason(Play play, Account? account, VenueDescriptor? venue) =>
        play.Status == PlayStatus.Draft ? "Plan the play to start tracking venue orders."
        : play.Status is PlayStatus.Closed or PlayStatus.Cancelled ? null
        : play.InstrumentSource != InstrumentSource.Venue || play.ContractId is null ? "Manual instruments are not tracked at a venue."
        : account is null || venue is not { Capabilities.Orders: true } ? "Orders are only tracked at venues that provide them."
        : !account.IsEnabled ? "Enable the account to track its orders."
        : account.SourceId is null ? "The account needs a source identity to track its orders."
        : null;

    /// <summary>The status path checks metadata only; the refresh path, already under the lock, opens the token.</summary>
    private async Task<string?> CredentialReasonAsync(Account account, bool usableOnly, CancellationToken ct) =>
        venues.Descriptor(account.VenueId)?.Capabilities.ReadOnlyCredential == true &&
        (credentials is null || !(usableOnly
            ? await credentials.IsUsableAsync(account, ct)
            : await credentials.ReadAsync(account.Id, ct) is not null))
            ? "Add or renew a read-only token to track orders." : null;

    /// <summary>The basis shared by every fill, "mixed" if they differ, or gross when there are none.</summary>
    private static string PnlBasis(IReadOnlyCollection<ImportedFill> fills) =>
        fills.Select(f => f.PnlBasis).Distinct().ToList() is [var only] ? only : fills.Count == 0 ? ExecutionFacts.PnlGross : "mixed";

    private static string Money(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private static string Name<T>(T value) where T : Enum => value.ToString().ToLowerInvariant();

    private static ExecutionOrderDto OrderDto(ImportedOrder o) => new(o.OrderId, o.Side, o.OrderType, Money(o.LimitPrice),
        o.TriggerPrice is { } trigger ? Money(trigger) : null, o.ReduceOnly, o.IsPositionTpsl, Money(o.OriginalSize), Money(o.RemainingSize),
        o.PlacedAtUtc, o.Status, o.VenueStatus, o.StatusAtUtc);

    private static ExecutionFillDto FillDto(ImportedFill f) => new(f.SourceFillId, f.Direction, Money(f.Price), Money(f.Quantity),
        Money(f.Fee), f.FeeToken, Money(f.ClosedPnlUsd), f.OccurredAtUtc, f.Side, f.PositionEffect, f.PnlBasis);
}
