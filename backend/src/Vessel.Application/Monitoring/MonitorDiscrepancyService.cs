using Vessel.Application.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Application.Workspace;
using Vessel.Domain.Monitoring;

namespace Vessel.Application.Monitoring;

/// <summary>Observes discrepancies only; never changes executions, links or Play status.</summary>
public sealed partial class MonitorDiscrepancyService(IMonitorDiscrepancyStore store, IUnitOfWork work,
    IJournalOwnerContext owner, IPlayEventSink events, MonitorOptions options, TimeProvider clock) : IMonitorEvaluator
{
    public static readonly TimeSpan ConfirmationDelay = TimeSpan.FromSeconds(60);

    public async Task<MonitorEvaluationResult> EvaluateAsync(MonitorEvaluation observation, CancellationToken ct)
    {
        if (observation.Account.OwnerId != owner.OwnerId) throw new ProblemException(404, "Account not found.");
        var facts = await store.LoadAsync(observation.Account.Id, ct);
        var records = await store.RecordsAsync(observation.Account.Id, ct);
        var now = clock.GetUtcNow();
        var scan = Observe(observation, facts, now);
        DateTimeOffset? next = scan.Next;
        var seen = new HashSet<(string, string)>();
        foreach (var finding in scan.Findings)
        {
            var key = (finding.Kind, finding.Subject);
            seen.Add(key);
            var row = records.SingleOrDefault(x => x.Kind == key.Kind && x.SubjectKey == key.Subject);
            var json = JsonSerializer.Serialize(finding.Details);
            // Event data is capped at 32 KiB. Never silently truncate evidence used for confirmation.
            if (finding.Present is null || Encoding.UTF8.GetByteCount(json) > 16_000)
            {
                scan.Incomplete = true;
                row?.InterruptConfirmation();
                continue;
            }
            if (row is null)
            {
                if (!finding.Present.Value) continue;
                row = new PlayDiscrepancy
                {
                    OwnerId = owner.OwnerId, AccountId = observation.Account.Id, PlayId = finding.PlayId,
                    ContractId = finding.Contract, NativeContractId = finding.Native, Kind = finding.Kind,
                    SubjectKey = finding.Subject, Severity = finding.Severity, OpenedAtUtc = finding.At
                };
                store.Add(row);
            }
            // A repeated delivery of the same source snapshot is not independent confirmation.
            if (finding.At <= row.LastObservedAtUtc) { scan.Incomplete = true; continue; }
            row.LastObservedAtUtc = finding.At;
            var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
            if (row.State is "open" or "dismissed" && finding.Present.Value && row.Fingerprint == fingerprint ||
                row.State == "resolved" && !finding.Present.Value)
            {
                row.InterruptConfirmation();
                continue;
            }
            if (!finding.Present.Value)
            {
                // Complete fresh clearance resolves immediately. A terminal exit watch can stop after this
                // read, so requiring another run would leave its orphan warning permanently open.
                var publish = row.State == "open";
                row.InterruptConfirmation();
                row.InvolvedPlayIds = finding.PlayIds;
                row.Details = json;
                row.Fingerprint = fingerprint;
                row.State = "resolved";
                row.ResolvedAtUtc = now;
                row.Revision++;
                if (publish) await Publish(row, observation.RunId, observation.Account.VenueId, observation.Trigger, "resolved", now, ct);
                continue;
            }
            var pending = fingerprint;
            if (row.PendingFingerprint != pending)
            {
                row.PendingFingerprint = pending;
                row.PendingSinceUtc = finding.At;
            }
            var deadline = row.PendingSinceUtc!.Value + ConfirmationDelay;
            if (finding.At < deadline)
            {
                next = Earlier(next, deadline > now ? deadline : now + ConfirmationDelay);
                continue;
            }
            var firstObserved = row.PendingSinceUtc!.Value;
            row.InterruptConfirmation();
            row.InvolvedPlayIds = finding.PlayIds;
            row.Details = json;
            row.Fingerprint = fingerprint;
            row.State = "open";
            row.OpenedAtUtc = firstObserved;
            row.ConfirmedAtUtc = now;
            row.ResolvedAtUtc = row.DismissedAtUtc = null;
            row.Note = null;
            row.Revision++;
            await Publish(row, observation.RunId, observation.Account.VenueId, observation.Trigger, "opened", now, ct);
        }
        foreach (var row in records.Where(x => !seen.Contains((x.Kind, x.SubjectKey))))
        {
            // A missing subject (e.g. retired catalogue identity) is not proof that a condition cleared.
            row.InterruptConfirmation();
            if (row.State is "open" or "dismissed" or "candidate") scan.Incomplete = true;
        }
        return new(next, scan.Incomplete, scan.Incomplete ? "Some discrepancy checks lack fresh, complete or consistent evidence." : null);
    }

    public async Task<IReadOnlyList<MonitorDiscrepancyDto>> ReadAsync(Guid accountId, Guid? playId, CancellationToken ct)
    {
        await RequireSubject(accountId, playId, ct);
        return (await store.RecordsAsync(accountId, ct)).Where(x => x.ConfirmedAtUtc is not null && x.State != "candidate" &&
            (playId is null || x.PlayId == playId || x.InvolvedPlayIds.Contains(playId.Value)))
            .OrderByDescending(x => x.ConfirmedAtUtc).ThenBy(x => x.Id).Take(500).Select(Dto).ToArray();
    }

    /// <summary>Owner/account and optional involved-Play membership are validated under the account fence.</summary>
    public async Task DismissPlayAsync(Guid playId, Guid discrepancyId, string? note, CancellationToken ct)
    {
        var play = await store.PlayAsync(playId, ct);
        if (play?.OwnerId != owner.OwnerId) throw new ProblemException(404, "Play not found.");
        await DismissAsync(play.AccountId, playId, discrepancyId, note, ct);
    }

    public Task DismissAsync(Guid accountId, Guid? playId, Guid discrepancyId, string? note, CancellationToken ct) =>
        work.ExecuteAsync(async () =>
        {
            note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
            if (note?.Length > PlayDiscrepancy.MaxNoteLength || note?.Any(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t')) == true)
                throw new ProblemException(400, $"Notes must be plain text of at most {PlayDiscrepancy.MaxNoteLength} characters.");
            await store.LockAsync(accountId, ct);
            var account = await RequireSubject(accountId, playId, ct);
            var row = (await store.RecordsAsync(accountId, ct)).SingleOrDefault(x => x.Id == discrepancyId && x.ConfirmedAtUtc is not null && x.State != "candidate" &&
                (playId is null || x.PlayId == playId || x.InvolvedPlayIds.Contains(playId.Value)))
                ?? throw new ProblemException(404, "Discrepancy not found.");
            if (row.State == "dismissed") return true;
            if (row.State != "open") throw new ProblemException(409, "Only open discrepancies can be dismissed.");
            row.State = "dismissed";
            row.DismissedAtUtc = clock.GetUtcNow();
            row.Note = note;
            row.InterruptConfirmation();
            row.Revision++;
            await Publish(row, Guid.NewGuid(), account.VenueId, "owner", "dismissed", row.DismissedAtUtc.Value, ct);
            return true;
        }, ct);

    private async Task<Vessel.Domain.Accounts.Account> RequireSubject(Guid accountId, Guid? playId, CancellationToken ct)
    {
        var account = await store.AccountAsync(accountId, ct);
        if (account?.OwnerId != owner.OwnerId) throw new ProblemException(404, "Account not found.");
        if (playId is { } id)
        {
            var play = await store.PlayAsync(id, ct);
            if (play?.AccountId != accountId || play.OwnerId != owner.OwnerId) throw new ProblemException(404, "Play not found.");
        }
        return account;
    }

    private Task Publish(PlayDiscrepancy row, Guid run, string venue, string trigger, string transition, DateTimeOffset now, CancellationToken ct) =>
        events.AppendAsync(new(transition == "opened" ? "discrepancy.opened" : "discrepancy.resolved", run,
            $"discrepancy:{row.Id}:{row.Revision}:{transition}", transition == "opened" ? row.Severity : "info", now, now,
            new(AccountId: row.AccountId, VenueId: venue, ContractId: row.ContractId, PlayId: row.PlayId, DiscrepancyId: row.Id),
            new(trigger == "owner" ? "owner" : "monitor"), JsonSerializer.SerializeToElement(new { kind = row.Kind, state = row.State, resolution = transition == "opened" ? null : transition,
                fingerprint = row.Fingerprint, details = JsonSerializer.Deserialize<JsonElement>(row.Details), note = row.Note })), ct);

    private static MonitorDiscrepancyDto Dto(PlayDiscrepancy row) => new(row.Id, row.AccountId, row.PlayId, row.ContractId,
        row.Kind, row.Severity, row.State, row.OpenedAtUtc, row.ConfirmedAtUtc, row.ResolvedAtUtc, row.DismissedAtUtc,
        row.Note, JsonSerializer.Deserialize<JsonElement>(row.Details));
    private static DateTimeOffset Earlier(DateTimeOffset? a, DateTimeOffset b) => a is { } value && value < b ? value : b;
}
