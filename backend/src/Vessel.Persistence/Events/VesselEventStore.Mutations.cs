using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Events;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Sizing;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence.Events;

public sealed partial class VesselEventStore
{
    private async Task CaptureMutationsAsync(CancellationToken ct)
    {
        var detected = DateTimeOffset.UtcNow;
        foreach (var change in mutations.StatusChanges)
        {
            var play = await db.Plays.SingleOrDefaultAsync(p => p.Id == change.PlayId, ct);
            if (play is null) continue;
            var type = change.To == PlayStatus.Open && change.From is PlayStatus.Planned or PlayStatus.Paused
                ? "play.opened" : change.From == PlayStatus.Open && change.To == PlayStatus.Closed
                    ? "play.closed" : "play.status-changed";
            var key = type == "play.opened" ? $"play:{play.Id}:opened" : type == "play.closed"
                ? $"play:{play.Id}:closed" : $"status-change:{change.Id}";
            var account = await db.Accounts.SingleAsync(a => a.Id == play.AccountId, ct);
            var occurred = await LifecycleSourceTimeAsync(play, change, ct);
            var data = type == "play.closed" ? await ClosedDataAsync(play, ct) : JsonSerializer.SerializeToElement(new
            {
                previous = change.From.ToString().ToLowerInvariant(), current = change.To.ToString().ToLowerInvariant(),
                source = change.Source.ToString().ToLowerInvariant(), reason = change.Reason?.ToString().ToLowerInvariant()
            }, Json);
            await AppendAsync(new(type, runId, key, change.From == PlayStatus.Paused && change.To == PlayStatus.Open
                ? "warning" : "info", occurred, detected,
                new(play.AccountId, account.VenueId, play.ContractId, play.Id), new(trigger), data,
                Timeliness(occurred, detected), play.Status == change.To ? "current" : "superseded"), ct);
        }
        foreach (var link in mutations.Links)
        {
            var account = await db.Accounts.SingleAsync(a => a.Id == link.AccountId, ct);
            var play = await db.Plays.SingleAsync(p => p.Id == link.PlayId, ct);
            var subject = new VesselEventSubject(link.AccountId, account.VenueId, play.ContractId, link.PlayId, link.EntryId, link.LevelId);
            var source = new VesselEventSource(link.Source == OrderLinkSource.Owner ? "owner" : trigger, [link.OrderId]);
            var data = JsonSerializer.SerializeToElement(new
            {
                linkId = link.LinkId, previous = link.Previous, current = link.Current,
                role = link.Role.ToString().ToLowerInvariant(), source = link.Source.ToString().ToLowerInvariant()
            }, Json);
            var finalState = await db.OrderLinks.Where(l => l.Id == link.LinkId).Select(l => (OrderLinkState?)l.State)
                .SingleOrDefaultAsync(ct);
            var relevance = (finalState?.ToString().ToLowerInvariant() ?? "unlinked") == link.Current ? "current" : "superseded";
            if (link.Current == "suggested")
                await AppendAsync(new("link.needs-confirmation", runId, $"link:{link.LinkId}:suggested", "warning",
                    link.OccurredAt, detected, subject, source, data, Timeliness(link.OccurredAt, detected), relevance), ct);
            else
                await AppendAsync(new("execution.link-changed", runId, $"link-change:{link.ChangeId}", "info",
                    link.OccurredAt, detected, subject, source, data, Timeliness(link.OccurredAt, detected), relevance), ct);
        }
        foreach (var affected in mutations.FillOrders.OrderBy(x => x.AccountId).ThenBy(x => x.OrderId, StringComparer.Ordinal))
            await CaptureFillsAsync(affected.AccountId, affected.OrderId, detected, ct);
    }

    private async Task<DateTimeOffset> LifecycleSourceTimeAsync(Play play, PlayStatusChange change, CancellationToken ct)
    {
        // Mutations still decide whether an event exists. Linked facts only supply its source timestamp.
        // Manual facts and owner lifecycle actions retain their action time, even when facts are backdated.
        var fallback = change.OccurredAtUtc;
        if (play.InstrumentSource != InstrumentSource.Venue || change.Source != StatusChangeSource.Venue ||
            change.To is not (PlayStatus.Open or PlayStatus.Closed)) return fallback;
        var links = await db.OrderLinks.Where(l => l.PlayId == play.Id && l.State == OrderLinkState.Linked).ToListAsync(ct);
        var ids = links.Select(l => l.OrderId).ToArray();
        var fills = await db.Fills.Where(f => f.AccountId == play.AccountId && f.ContractId == play.ContractId &&
            ids.Contains(f.OrderId)).ToListAsync(ct);
        var facts = links.SelectMany(l => fills.Where(f => f.OrderId == l.OrderId)
            .Select(f => new LinkedFill(l.Role, f))).ToList();
        if (facts.Any(f => f.Fill.Quantity <= 0)) return fallback;
        var side = ExecutionIntegrity.EntrySide(PlayDocuments.Read(play.Plan));
        var counted = facts.Where(f => !ExecutionIntegrity.Contradicts(f.Role, side, f.Fill)).ToList();
        var entries = counted.Where(f => f.Role == OrderLinkRole.Entry).ToList();
        if (entries.Count == 0) return fallback;
        var orders = await db.Orders.Where(o => o.AccountId == play.AccountId && ids.Contains(o.OrderId)).ToListAsync(ct);
        var incomplete = orders.Where(o => ExecutionIntegrity.MissingExecutions(o, fills.Where(f => f.OrderId == o.OrderId)))
            .Select(o => o.OrderId).ToHashSet(StringComparer.Ordinal);
        DateTimeOffset occurred;
        if (change.To == PlayStatus.Open)
        {
            // A partial resting order is valid evidence. Known missing executions cannot establish the first fill.
            if (links.Any(l => l.Role == OrderLinkRole.Entry && incomplete.Contains(l.OrderId))) return fallback;
            occurred = entries.Min(f => f.Fill.OccurredAtUtc);
        }
        else
        {
            var entryOrders = links.Where(l => l.Role == OrderLinkRole.Entry).Select(l => l.OrderId).ToHashSet(StringComparer.Ordinal);
            if (orders.Any(o => entryOrders.Contains(o.OrderId) && o.Status == "open") ||
                !ExecutionIntegrity.Settled(new(play, [], facts, incomplete))) return fallback;
            occurred = counted.Where(f => f.Role != OrderLinkRole.Entry).Max(f => f.Fill.OccurredAtUtc);
        }
        // An implausible future source timestamp is not evidence that a mutation happened in the future.
        return occurred <= fallback ? occurred : fallback;
    }

    private async Task CaptureFillsAsync(Guid accountId, string orderId, DateTimeOffset detected, CancellationToken ct)
    {
        DateTimeOffset baseline;
        await using (var command = VesselEventSql.TransactionCommand(db, """
            SELECT started_at FROM event_baselines WHERE owner_id=@owner AND account_id=@account
            """, ("owner", db.CurrentOwnerId), ("account", accountId)))
        {
            if (await command.ExecuteScalarAsync(ct) is not DateTime value) return;
            baseline = new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc));
        }
        var link = await db.OrderLinks.SingleOrDefaultAsync(l => l.AccountId == accountId &&
            l.OrderId == orderId && l.State == OrderLinkState.Linked, ct);
        if (link is null) return;
        var play = await db.Plays.SingleAsync(p => p.Id == link.PlayId, ct);
        // Retrospective creation links history, not a new watched execution.
        var historical = play.Origin == PlayOrigin.Retrospective;
        var fills = await db.Fills.Where(f => f.AccountId == accountId && f.OrderId == orderId &&
            f.ContractId == play.ContractId).OrderBy(f => f.OccurredAtUtc).ThenBy(f => f.SourceFillId).ToListAsync(ct);
        if (fills.Count == 0) return;
        var newlyClaimed = new List<ImportedFill>();
        foreach (var fill in fills)
        {
            await using var claim = VesselEventSql.TransactionCommand(db, """
                INSERT INTO event_fills(owner_id,account_id,contract_id,source_fill_id)
                VALUES(@owner,@account,@contract,@fill) ON CONFLICT DO NOTHING RETURNING source_fill_id
                """, ("owner", db.CurrentOwnerId), ("account", accountId), ("contract", fill.ContractId),
                ("fill", fill.SourceFillId));
            if (await claim.ExecuteScalarAsync(ct) is not null && !historical && fill.OccurredAtUtc >= baseline)
                newlyClaimed.Add(fill);
        }
        if (newlyClaimed.Count == 0) return;
        // Integrity rules match the existing lifecycle, not the venue's raw side vocabulary.
        var side = ExecutionIntegrity.EntrySide(PlayDocuments.Read(play.Plan));
        newlyClaimed.RemoveAll(f => ExecutionIntegrity.Contradicts(link.Role, side, f));
        if (newlyClaimed.Count == 0) return;
        var order = await db.Orders.SingleOrDefaultAsync(o => o.AccountId == accountId && o.OrderId == orderId, ct);
        var account = await db.Accounts.SingleAsync(a => a.Id == accountId, ct);
        var counted = fills.Where(f => !ExecutionIntegrity.Contradicts(link.Role, side, f)).ToList();
        var cumulative = VesselEventValues.Sum(counted.Select(f => f.Quantity));
        var occurred = newlyClaimed.Max(f => f.OccurredAtUtc);
        var data = JsonSerializer.SerializeToElement(new
        {
            role = link.Role.ToString().ToLowerInvariant(), side = newlyClaimed[0].Side,
            filledQuantity = VesselEventValues.Sum(newlyClaimed.Select(f => f.Quantity)), cumulativeQuantity = cumulative,
            remainingQuantity = order is null ? null : VesselEventValues.Exact(order.RemainingSize),
            averagePrice = VesselEventValues.AveragePrice(counted.Select(f => (f.Price, f.Quantity))),
            sourceFillCount = newlyClaimed.Count, sourceFillIdsComplete = newlyClaimed.Count <= 200,
            // A venue's "filled" status alone does not prove all executions are retained.
            complete = order is not null && order.Status == "filled" && !ExecutionIntegrity.MissingExecutions(order, counted)
        }, Json);
        await AppendAsync(new("execution.filled", runId, $"order:{accountId}:{orderId}:filled:{cumulative}",
            link.Role == OrderLinkRole.Stop ? "warning" : "info", occurred, detected,
            new(accountId, account.VenueId, play.ContractId, play.Id, link.EntryId, link.LevelId),
            new(trigger, [orderId], newlyClaimed.Take(200).Select(f => f.SourceFillId).ToArray()), data,
            Timeliness(occurred, detected), play.Status is PlayStatus.Closed or PlayStatus.Cancelled ? "superseded" : "current"), ct);
    }

    private async Task<JsonElement> ClosedDataAsync(Play play, CancellationToken ct)
    {
        var links = await db.OrderLinks.Where(l => l.PlayId == play.Id && l.State == OrderLinkState.Linked).ToListAsync(ct);
        var orders = links.Select(l => l.OrderId).ToArray();
        var imported = await db.Fills.Where(f => f.AccountId == play.AccountId && orders.Contains(f.OrderId)).ToListAsync(ct);
        var facts = links.SelectMany(l => imported.Where(f => f.OrderId == l.OrderId).Select(f => (Role: l.Role, Fill: f))).ToList();
        if (play.InstrumentSource == InstrumentSource.Manual)
        {
            var rows = await db.ManualExecutions.Where(f => f.PlayId == play.Id).ToListAsync(ct);
            var ledger = ManualLedger.Calculate(play, rows);
            facts = ledger.Projection.Select(x => (x.Role, x.Fill)).ToList();
        }
        var counted = facts.Where(f => !ExecutionIntegrity.Contradicts(f.Role,
            ExecutionIntegrity.EntrySide(PlayDocuments.Read(play.Plan)), f.Fill)).ToList();
        var basis = counted.Select(f => f.Fill.PnlBasis).Distinct(StringComparer.Ordinal).ToList();
        return JsonSerializer.SerializeToElement(new
        {
            enteredQuantity = VesselEventValues.Sum(counted.Where(f => f.Role == OrderLinkRole.Entry).Select(f => f.Fill.Quantity)),
            exitedQuantity = VesselEventValues.Sum(counted.Where(f => f.Role != OrderLinkRole.Entry).Select(f => f.Fill.Quantity)),
            closedPnlUsd = VesselEventValues.Sum(counted.Select(f => f.Fill.ClosedPnlUsd)),
            closedPnlBasis = basis.Count == 1 ? basis[0] : basis.Count == 0 ? ExecutionFacts.PnlGross : "mixed",
            fees = counted.GroupBy(f => f.Fill.FeeToken).OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => new { token = g.Key, amount = VesselEventValues.Sum(g.Select(f => f.Fill.Fee)) }).ToArray()
        }, Json);
    }

    private string Timeliness(DateTimeOffset occurred, DateTimeOffset detected) =>
        settings.Value.Timeliness(occurred, detected);
}
