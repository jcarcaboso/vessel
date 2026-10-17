using System.Globalization;
using System.Text.Json;
using Vessel.Application.Events;

namespace Vessel.Application.Notifications;

/// <summary>
/// The <c>notifications</c> subscription's handler. It runs inside the dispatcher's unit of work with the receipt
/// locked, so every effect is database-only and keyed on event identity: a redelivery or catch-up changes nothing.
/// Run events are grouped per account and run; discrepancy, monitor and credential events stand alone so a later
/// generation of the same subject can withdraw exactly what it supersedes. Withdrawal runs before any preference,
/// trigger or age rule.
/// </summary>
public sealed class NotificationHub(INotificationHubStore store, NotificationOptions options, TimeProvider time) : IVesselEventSubscriber
{
    private const int CandidatePage = 200;
    /// <summary>At most this many pages of a run's uncovered events are examined per dispatch, besides the waking event.</summary>
    private const int CandidatePages = 10;

    public Task<EventHandling> HandleAsync(VesselEvent message, CancellationToken cancellationToken) =>
        NotificationIdentity.KindOf(message.Type) switch
        {
            NotificationKind.Run => RunAsync(message, cancellationToken),
            NotificationKind.Test => TestAsync(message, cancellationToken),
            null => Task.FromResult(EventHandling.Skipped),
            _ => StandaloneAsync(message, cancellationToken)
        };

    private async Task<EventHandling> RunAsync(VesselEvent message, CancellationToken ct)
    {
        var account = message.Subject.AccountId;
        await store.LockAsync($"notification-run:{message.RunId:N}:{account:N}", ct);
        if (await store.HandledAsync(message.Id, ct)) return EventHandling.Delivered;
        var now = time.GetUtcNow();
        var preferences = await store.PreferencesAsync(ct);

        // Page past rejected candidates: a prefix of ineligible events must not hide a later eligible one.
        var candidates = new List<VesselEvent>();
        for (var page = 0; page < CandidatePages; page++)
        {
            var batch = await store.RunCandidatesAsync(message.RunId, account,
                candidates.Count == 0 ? 0 : long.Parse(candidates[^1].Sequence, CultureInfo.InvariantCulture), CandidatePage, ct);
            candidates.AddRange(batch);
            if (batch.Count < CandidatePage) break;
        }
        // The waking event is always examined, however long the run.
        if (candidates.All(c => c.Id != message.Id)) candidates.Add(message);
        var context = await store.ContextAsync(account, candidates.Where(c => c.Subject.PlayId is not null)
            .Select(c => c.Subject.PlayId!.Value).Distinct().ToArray(), ct);
        if (context is null) return EventHandling.Skipped;

        // Every candidate passes every check itself; the waking event's checks say nothing about its peers.
        var eligible = new List<VesselEvent>();
        foreach (var candidate in candidates)
        {
            if (NotificationIdentity.KindOf(candidate.Type) != NotificationKind.Run || candidate.Version != 1 ||
                candidate.ExpiresAt is { } expires && expires <= now ||
                !NotificationRules.Eligible(candidate, preferences, now, options.MaxEventAge) ||
                candidate.Subject.PlayId is { } play && !context.Plays.ContainsKey(play))
                continue;
            if (candidate.Type == "link.needs-confirmation" &&
                !(Id(candidate, "linkId") is { } link && await store.LinkActionableAsync(link, ct)))
                continue;
            eligible.Add(candidate);
        }
        var covered = Select(eligible, message);
        // Detail lines never notify alone and are not consumed, so a later batch of the same run can still show them.
        if (covered.Count == 0) return EventHandling.Skipped;

        var headlines = covered.Where(e => !NotificationRules.Detail(e.Type)).ToList();
        var plays = covered.Where(e => e.Subject.PlayId is not null).Select(e => e.Subject.PlayId!.Value).Distinct().ToList();
        await store.CreateAsync(new(Guid.CreateVersion7(), NotificationKind.Run,
            headlines.All(e => e.Type == "link.needs-confirmation") ? NotificationValues.Links : NotificationValues.Executions,
            NotificationValues.Highest(covered.Select(e => e.Severity)), account, plays.Count == 1 ? plays[0] : null,
            message.RunId, Content(covered, context, now), covered.Min(e => e.OccurredAt), covered.Max(e => e.DetectedAt),
            covered.Select(e => new NotificationSource(e.Id, e.Type, e.Subject.AccountId)).ToArray()), ct);
        return covered.Any(e => e.Id == message.Id) ? EventHandling.Delivered : EventHandling.Skipped;
    }

    /// <summary>
    /// The events one run notification covers, in sequence order: headlines first within <c>RunGroupLimit</c>, always
    /// including the waking event when it is an eligible headline (every eligible headline's own dispatch therefore
    /// covers it, so none is lost to overflow), then detail lines in the remaining budget. Empty without a headline.
    /// </summary>
    private List<VesselEvent> Select(List<VesselEvent> eligible, VesselEvent message)
    {
        var headlines = eligible.Where(e => !NotificationRules.Detail(e.Type)).Take(options.RunGroupLimit).ToList();
        if (headlines.Count == 0) return [];
        if (eligible.FirstOrDefault(e => e.Id == message.Id) is { } waking && !NotificationRules.Detail(waking.Type) &&
            headlines.All(e => e.Id != message.Id))
            headlines[^1] = waking;
        var details = eligible.Where(e => NotificationRules.Detail(e.Type)).Take(options.RunGroupLimit - headlines.Count);
        return [.. headlines.Concat(details).OrderBy(e => long.Parse(e.Sequence, CultureInfo.InvariantCulture))];
    }

    private async Task<EventHandling> StandaloneAsync(VesselEvent message, CancellationToken ct)
    {
        if (NotificationIdentity.Parse(message) is not { } identity) return EventHandling.Skipped;
        await store.LockAsync($"notification-subject:{identity.Subject}", ct);
        if (await store.HandledAsync(message.Id, ct)) return EventHandling.Delivered;
        var source = new NotificationSource(message.Id, message.Type, message.Subject.AccountId, identity.Subject,
            identity.Generation, identity.Revision, identity.Transition);
        var previous = await store.SubjectSourcesAsync(identity.Subject, ct);
        // Out of order: a newer generation already decided this subject's notifications.
        if (previous.Any(p => p.Generation > identity.Generation))
        {
            await store.RecordHandledAsync([source], ct);
            return EventHandling.Skipped;
        }
        var older = previous.Where(p => p.Generation < identity.Generation).ToList();

        // Withdrawal first, whatever the preferences, trigger or age of this event.
        var superseded = older.Where(p => p is { NotificationId: not null, DeliveryState: NotificationValues.Unread } &&
                Withdraws(identity, p)).Select(p => p.NotificationId!.Value).Distinct().ToArray();
        var withdrawn = superseded.Length == 0 ? 0 : await store.WithdrawAsync(superseded, ct);

        var now = time.GetUtcNow();
        if (Decide(identity, message, older) is { } severity &&
            NotificationRules.Eligible(message with { Severity = severity }, await store.PreferencesAsync(ct), now, options.MaxEventAge) &&
            await RelevantAsync(identity, now, ct) &&
            await store.ContextAsync(message.Subject.AccountId, message.Subject.PlayId is { } play ? [play] : [], ct) is { } context &&
            (message.Subject.PlayId is not { } subjectPlay || context.Plays.ContainsKey(subjectPlay)))
        {
            var created = await store.CreateAsync(new(Guid.CreateVersion7(), identity.Kind, NotificationRules.Category(message.Type)!,
                severity, message.Subject.AccountId, message.Subject.PlayId, message.RunId, Content([message], context, now),
                message.OccurredAt, message.DetectedAt, [source]), ct);
            return created || withdrawn > 0 ? EventHandling.Delivered : EventHandling.Skipped;
        }
        await store.RecordHandledAsync([source], ct);
        return withdrawn > 0 ? EventHandling.Delivered : EventHandling.Skipped;
    }

    private async Task<EventHandling> TestAsync(VesselEvent message, CancellationToken ct)
    {
        await store.LockAsync($"notification-test:{message.Id:N}", ct);
        if (await store.HandledAsync(message.Id, ct)) return EventHandling.Delivered;
        var now = time.GetUtcNow();
        if (!NotificationRules.Eligible(message, await store.PreferencesAsync(ct), now, options.MaxEventAge) ||
            await store.ContextAsync(null, [], ct) is not { } context)
            return EventHandling.Skipped;
        await store.CreateAsync(new(Guid.CreateVersion7(), NotificationKind.Test, NotificationValues.Test, "info", null, null,
            message.RunId, Content([message], context, now), message.OccurredAt, message.DetectedAt,
            [new NotificationSource(message.Id, message.Type, null)]), ct);
        return EventHandling.Delivered;
    }

    /// <summary>Which unread notifications of older generations this event supersedes.</summary>
    private static bool Withdraws(NotificationIdentity identity, NotificationSubjectSource older) =>
        // Unverifiable is not a resolution: it keeps the opening and only replaces a stale resolution notice.
        identity is not { Kind: NotificationKind.Discrepancy, Transition: "unverifiable" } || older.Transition is "resolved" or "dismissed";

    /// <summary>The severity of the notification this event should create, or null when it should create none.</summary>
    private static string? Decide(NotificationIdentity identity, VesselEvent message, IReadOnlyList<NotificationSubjectSource> older)
    {
        switch (identity.Kind)
        {
            case NotificationKind.Discrepancy when identity.Transition is "opened" or "unverifiable":
                return message.Severity;
            case NotificationKind.Discrepancy:
                // A resolution is news only when the owner read the opening it closes.
                var closed = older.Where(p => p.Transition is "resolved" or "dismissed").Select(p => p.Generation).DefaultIfEmpty(-1).Max();
                return identity.Transition == "resolved" && older.Any(p => p.Transition is "opened" or "unverifiable" &&
                    p is { NotificationId: not null, DeliveryState: NotificationValues.Read } && p.Generation > closed) ? "info" : null;
            case NotificationKind.Monitor when NotificationRules.Problem(identity.Transition):
                return "warning";
            case NotificationKind.Monitor:
                // A recovery is news only when the owner read the latest problem it ends.
                var healthy = older.Where(p => !NotificationRules.Problem(p.Transition)).Select(p => p.Generation).DefaultIfEmpty(-1).Max();
                var latest = older.Where(p => NotificationRules.Problem(p.Transition) && p.Generation > healthy).MaxBy(p => p.Generation);
                return latest is { NotificationId: not null, DeliveryState: NotificationValues.Read } ? "info" : null;
            case NotificationKind.Credential:
                return "warning";
            default:
                return null;
        }
    }

    private async Task<bool> RelevantAsync(NotificationIdentity identity, DateTimeOffset now, CancellationToken ct)
    {
        var state = await store.SubjectStateAsync(identity, ct);
        return state.Exists && state.CurrentRevision == identity.Revision &&
            (identity.Kind != NotificationKind.Credential || state.ExpiresAt > now);
    }

    /// <summary>Composed content, marked late when the producer said so or when the hub itself handles it late.</summary>
    private NotificationContent Content(IReadOnlyList<VesselEvent> events, NotificationContext context, DateTimeOffset now)
    {
        var content = NotificationComposer.Compose(events, context);
        return now - events.Max(e => e.DetectedAt) > options.MonitorInterval * 2 ? content with { Late = true } : content;
    }

    private static Guid? Id(VesselEvent message, string name) =>
        message.Data.ValueKind == JsonValueKind.Object && message.Data.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id) ? id : null;
}
