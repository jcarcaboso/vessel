using System.Globalization;
using Vessel.Application.Events;

namespace Vessel.Application.Notifications;

public enum NotificationKind { Run, Discrepancy, Monitor, Credential, Test }

/// <summary>
/// The subject of a standalone event and the revision it announces, parsed from its documented v1 dedup key so the
/// producers stay unchanged: <c>discrepancy:{id}:{revision}:{transition}</c>, <c>monitor:{accountId}:{stateRevision}:{state}</c>
/// and <c>credential:{accountId}:{credentialRevision}:expiring</c>. The subject is the withdrawal and locking key. Its
/// generation is the event's commit-ordered sequence: every later announcement of a subject commits later, and a
/// credential revision is a hash with no order of its own.
/// </summary>
public sealed record NotificationIdentity(NotificationKind Kind, string Subject, long Generation, string Revision,
    string Transition, Guid SubjectId)
{
    private static readonly string[] DiscrepancyTransitions = ["opened", "unverifiable", "resolved", "dismissed"];
    private static readonly string[] MonitorStates = ["live", "stale", "degraded", "credential-error", "idle"];

    public static NotificationKind? KindOf(string type) => type switch
    {
        "play.opened" or "play.closed" or "play.status-changed" or "execution.filled" or
            "link.needs-confirmation" or "execution.link-changed" => NotificationKind.Run,
        "discrepancy.opened" or "discrepancy.unverifiable" or "discrepancy.resolved" => NotificationKind.Discrepancy,
        "monitor.state-changed" => NotificationKind.Monitor,
        "credential.expiring" => NotificationKind.Credential,
        NotificationRules.TestType => NotificationKind.Test,
        _ => null
    };

    /// <summary>The identity of a discrepancy, monitor or credential event, or null when its key does not parse.</summary>
    public static NotificationIdentity? Parse(VesselEvent message)
    {
        var parts = message.DedupKey.Split(':');
        if (parts.Length != 4 || !Guid.TryParse(parts[1], out var id) || id == Guid.Empty ||
            !long.TryParse(message.Sequence, NumberStyles.None, CultureInfo.InvariantCulture, out var generation))
            return null;
        var revision = parts[2];
        var counted = long.TryParse(revision, NumberStyles.None, CultureInfo.InvariantCulture, out _);
        return KindOf(message.Type) switch
        {
            NotificationKind.Discrepancy when parts[0] == "discrepancy" && counted && DiscrepancyTransitions.Contains(parts[3]) &&
                message.Subject.DiscrepancyId == id && Matches(message.Type, parts[3]) =>
                new(NotificationKind.Discrepancy, $"discrepancy:{id:N}", generation, revision, parts[3], id),
            NotificationKind.Monitor when parts[0] == "monitor" && counted && MonitorStates.Contains(parts[3]) && message.Subject.AccountId == id =>
                new(NotificationKind.Monitor, $"monitor:{id:N}", generation, revision, parts[3], id),
            NotificationKind.Credential when parts[0] == "credential" && parts[3] == "expiring" && message.Subject.AccountId == id &&
                revision.Length is >= 1 and <= 128 && revision.All(char.IsAsciiHexDigit) =>
                new(NotificationKind.Credential, $"credential:{id:N}", generation, revision, parts[3], id),
            _ => null
        };
    }

    private static bool Matches(string type, string transition) => type switch
    {
        "discrepancy.opened" => transition == "opened",
        "discrepancy.unverifiable" => transition == "unverifiable",
        _ => transition is "resolved" or "dismissed"
    };
}
