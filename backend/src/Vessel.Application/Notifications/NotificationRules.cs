using Vessel.Application.Events;

namespace Vessel.Application.Notifications;

/// <summary>
/// Which events can become in-app notifications. Owner-triggered events never do (the page already showed the
/// result), except the explicit test; unknown types, owner Check completions and link changes on their own never do.
/// </summary>
public static class NotificationRules
{
    public const string TestType = "notification.test-requested";

    /// <summary>The category of a type that can notify, or null.</summary>
    public static string? Category(string type) => type switch
    {
        "play.opened" or "play.closed" or "play.status-changed" or "execution.filled" => NotificationValues.Executions,
        "link.needs-confirmation" => NotificationValues.Links,
        "discrepancy.opened" or "discrepancy.unverifiable" or "discrepancy.resolved" => NotificationValues.Discrepancies,
        "monitor.state-changed" => NotificationValues.Monitor,
        "credential.expiring" => NotificationValues.Credentials,
        TestType => NotificationValues.Test,
        _ => null
    };

    /// <summary>Events folded into a run's lifecycle notification as detail lines. They never notify alone.</summary>
    public static bool Detail(string type) => type == "execution.link-changed";

    /// <summary>
    /// Lifecycle events of one run are grouped into one notification. Discrepancy, monitor, credential and test
    /// events stand alone, so a later closing event can withdraw exactly the notification it closes.
    /// </summary>
    public static bool Groups(string type) => type is "play.opened" or "play.closed" or "play.status-changed" or
        "execution.filled" or "link.needs-confirmation" or "execution.link-changed";

    /// <summary>Monitor states that are a problem worth telling the owner about.</summary>
    public static bool Problem(string? state) => state is "degraded" or "stale" or "credential-error";

    /// <summary>Whether this event may start or join a notification, before relevance and withdrawal checks.</summary>
    public static bool Eligible(VesselEvent message, NotificationPreferences preferences, DateTimeOffset now, TimeSpan maxEventAge)
    {
        if (message.Type == TestType) return preferences.Enabled && message.DetectedAt >= now - maxEventAge;
        if (message.Source.Trigger != "monitor" || message.DetectedAt < now - maxEventAge) return false;
        if (Detail(message.Type)) return preferences.Allows(NotificationValues.Executions, message.Severity);
        return Category(message.Type) is { } category && preferences.Allows(category, message.Severity);
    }
}
