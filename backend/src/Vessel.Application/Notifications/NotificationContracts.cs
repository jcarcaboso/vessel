namespace Vessel.Application.Notifications;

/// <summary>Fixed vocabularies of the Notification Hub. Stored and sent as these exact strings.</summary>
public static class NotificationValues
{
    public const string InApp = "in-app";
    /// <summary>The hub's event subscription and module name.</summary>
    public const string Subscription = "notifications";

    public const string Executions = "executions";
    public const string Links = "links";
    public const string Discrepancies = "discrepancies";
    public const string Monitor = "monitor";
    public const string Credentials = "credentials";
    public const string Test = "test";

    /// <summary>Categories the owner can switch on or off. The test category always follows the channel switch.</summary>
    public static readonly string[] Categories = [Executions, Links, Discrepancies, Monitor, Credentials];
    public static readonly string[] Severities = ["info", "warning", "critical"];

    public const string Unread = "unread";
    public const string Read = "read";
    public const string Withdrawn = "withdrawn";

    public const int TitleLength = 160;
    public const int LineLength = 200;
    public const int MaxLines = 8;
    public const int MaxLinks = 3;

    public static int Rank(string severity) => Array.IndexOf(Severities, severity);
    public static string Highest(IEnumerable<string> severities) => severities.MaxBy(Rank) ?? "info";
}

/// <summary>A link the browser maps to its own navigation. Content never carries a URL.</summary>
public sealed record NotificationLink(string Kind, string Label, Guid? PlayId = null, Guid? AccountId = null)
{
    public static readonly string[] Kinds = ["play", "play-execution", "account", "account-credential"];
}

/// <summary>Names snapshotted when the notification was composed.</summary>
public sealed record NotificationSubject(Guid? AccountId, string? AccountName, string? VenueId, Guid? PlayId,
    string? PlayTitle, string? Instrument);

/// <summary>Channel-neutral content, composed once by the hub so every channel says the same thing.</summary>
public sealed record NotificationContent(string Title, string? Summary, IReadOnlyList<string> Lines, bool Late,
    IReadOnlyList<NotificationLink> Links, NotificationSubject Subject);

/// <summary>An owner's preferences for one channel. A missing record means <see cref="Defaults"/>.</summary>
public sealed record NotificationPreferences(bool Enabled, string MinimumSeverity, IReadOnlyList<string> Categories, long Revision)
{
    public static NotificationPreferences Defaults { get; } = new(true, "info", NotificationValues.Categories, 0);

    public bool Valid() => NotificationValues.Severities.Contains(MinimumSeverity) &&
        Categories.All(NotificationValues.Categories.Contains) && Categories.Distinct().Count() == Categories.Count;

    public bool Allows(string category, string severity) => Enabled &&
        (category == NotificationValues.Test ||
         Categories.Contains(category) && NotificationValues.Rank(severity) >= NotificationValues.Rank(MinimumSeverity));
}

public sealed class NotificationOptions
{
    public const string Section = "Vessel:Notifications";
    public int RetentionDays { get; set; } = 90;
    /// <summary>Events detected longer ago than this create no notification, so a hub back after a long outage does not flood the page.</summary>
    public TimeSpan MaxEventAge { get; set; } = TimeSpan.FromDays(7);
    /// <summary>A notification older than this when a tab first sees it is recorded as shown without a popup.</summary>
    public TimeSpan PopupWindow { get; set; } = TimeSpan.FromHours(24);
    public int RunGroupLimit { get; set; } = 200;
    public TimeSpan TestCooldown { get; set; } = TimeSpan.FromSeconds(10);
    public TimeSpan HeartbeatTimeout { get; set; } = TimeSpan.FromSeconds(90);
    public string HeartbeatFile { get; set; } = "/tmp/vessel-notifications-heartbeat";
    /// <summary>Bound from <c>Vessel:Monitor:Interval</c>: a notification handled more than twice this after detection is late.</summary>
    public TimeSpan MonitorInterval { get; set; } = TimeSpan.FromMinutes(10);

    public void Validate()
    {
        if (RetentionDays is < 7 or > 365 || MaxEventAge < TimeSpan.FromHours(1) || MaxEventAge > TimeSpan.FromDays(30) ||
            TimeSpan.FromDays(RetentionDays) < MaxEventAge + TimeSpan.FromDays(1) ||
            MonitorInterval < TimeSpan.FromMinutes(1) || MonitorInterval > TimeSpan.FromMinutes(60) ||
            PopupWindow < TimeSpan.FromMinutes(5) || PopupWindow > TimeSpan.FromDays(7) || RunGroupLimit is < 1 or > 1000 ||
            TestCooldown < TimeSpan.FromSeconds(1) || TestCooldown > TimeSpan.FromMinutes(5) ||
            HeartbeatTimeout < TimeSpan.FromSeconds(30) || HeartbeatTimeout > TimeSpan.FromMinutes(10) ||
            string.IsNullOrWhiteSpace(HeartbeatFile))
            throw new InvalidOperationException("Vessel:Notifications settings are outside their supported ranges.");
    }
}
