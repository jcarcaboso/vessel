using System.Globalization;
using System.Text.Json;
using Vessel.Application.Common;
using Vessel.Application.Events;
using Vessel.Application.Ownership;

namespace Vessel.Application.Notifications;

public sealed record NotificationDto(Guid Id, string Kind, string Category, string Severity, NotificationContent Content,
    DateTimeOffset OccurredAt, DateTimeOffset DetectedAt, DateTimeOffset CreatedAt, string State, DateTimeOffset? ReadAt);

/// <summary>A changed notification and its own position in the owner's feed, never a head the reader has not received.</summary>
public sealed record NotificationFeedItem(string Cursor, NotificationDto Notification);

public sealed record NotificationFeed(IReadOnlyList<NotificationFeedItem> Items, string NextCursor, int UnreadCount, bool Enabled,
    bool ResetRequired);

public sealed record NotificationHead(string NextCursor, int UnreadCount, bool Enabled);

/// <summary>The head with the notifications worker's status, for the badge, the offline banner and Settings.</summary>
public sealed record NotificationHeadDto(string NextCursor, int UnreadCount, bool Enabled, bool WorkerOnline, DateTimeOffset? HeartbeatAtUtc);

public sealed record NotificationPageQuery(string Tab = "unread", string? Category = null, string? Severity = null, int Page = 1, int PageSize = 25);

public sealed record NotificationPage(IReadOnlyList<NotificationDto> Items, int Page, int PageSize, int Total, int UnreadTotal, int AllTotal);

/// <summary>The popups this claim won (at most three, recent, most severe first) and how many other notifications it claimed.</summary>
public sealed record NotificationClaim(IReadOnlyList<NotificationDto> Popups, int More);

/// <summary>
/// The in-app preferences with the hub's health: its worker heartbeat, its subscription status (<c>active</c>,
/// <c>lagging</c> after events were skipped by retention, or null before provisioning) and its failed deliveries.
/// </summary>
public sealed record NotificationPreferencesDto(bool Enabled, string MinimumSeverity, IReadOnlyList<string> Categories, long Revision,
    bool WorkerOnline, DateTimeOffset? HeartbeatAtUtc, string? SubscriptionStatus, int FailedDeliveries);

public sealed record NotificationSubscriptionHealth(string? Status, int FailedDeliveries);

public sealed record UpdateNotificationPreferencesRequest(bool Enabled, string MinimumSeverity, IReadOnlyList<string> Categories, long ExpectedRevision);

/// <summary>
/// Owner notification cursor: <c>{epoch}.{resetVersion}.{sequence}</c>, with the event stream's epoch (32 hex digits, or
/// <c>0</c> before the owner has any event). Another epoch or reset version, or a sequence ahead of the head, resets.
/// </summary>
public readonly record struct NotificationCursor(Guid? Epoch, long Reset, long Sequence)
{
    public static bool TryParse(string? value, out NotificationCursor cursor)
    {
        cursor = default;
        var parts = value?.Split('.');
        if (parts is not { Length: 3 } || parts[1].Length > 19 || parts[2].Length > 19 ||
            !long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var reset) ||
            !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var sequence))
            return false;
        if (parts[0] == "0") { cursor = new(null, reset, sequence); return true; }
        if (parts[0].Length != 32 || !Guid.TryParseExact(parts[0], "N", out var epoch) || epoch == Guid.Empty ||
            parts[0] != epoch.ToString("N")) return false;
        cursor = new(epoch, reset, sequence);
        return true;
    }

    public override string ToString() => Format(Epoch, Reset, Sequence);

    public static string Format(Guid? epoch, long reset, long sequence) =>
        $"{(epoch is { } value ? value.ToString("N") : "0")}.{reset.ToString(CultureInfo.InvariantCulture)}.{sequence.ToString(CultureInfo.InvariantCulture)}";
}

/// <summary>Reads and owner actions on in-app notifications. All writes run in a unit of work.</summary>
public interface INotificationStore
{
    Task<NotificationHead> HeadAsync(CancellationToken ct);
    Task<NotificationFeed> FeedAsync(string? after, int limit, CancellationToken ct);
    Task<NotificationPage> PageAsync(NotificationPageQuery query, CancellationToken ct);
    Task<NotificationClaim> ClaimAsync(DateTimeOffset now, TimeSpan window, CancellationToken ct);
    Task<NotificationDto?> ReadAsync(Guid id, DateTimeOffset now, CancellationToken ct);
    Task<int> ReadAllAsync(NotificationCursor upTo, DateTimeOffset now, CancellationToken ct);
    Task<NotificationPreferences> PreferencesAsync(CancellationToken ct);
    Task<NotificationPreferences> SavePreferencesAsync(NotificationPreferences preferences, long expectedRevision, DateTimeOffset now, CancellationToken ct);
    /// <summary>Records the test request time under the cursor lock; the time left when another test is too recent.</summary>
    Task<TimeSpan?> StartTestAsync(DateTimeOffset now, TimeSpan cooldown, CancellationToken ct);
    Task<int> RetainAsync(DateTimeOffset cutoff, CancellationToken ct);
    Task<DateTimeOffset?> HeartbeatAsync(CancellationToken ct);
    Task<NotificationSubscriptionHealth> SubscriptionHealthAsync(CancellationToken ct);
}

public sealed class NotificationTestCooldownException(TimeSpan retryAfter) : Exception("A test notification was requested moments ago.")
{
    public TimeSpan RetryAfter { get; } = retryAfter;
}

public sealed class NotificationService(INotificationStore store, IUnitOfWork unitOfWork, IVesselEventSink events,
    NotificationOptions options, TimeProvider time)
{
    public const int MaxFeedLimit = 100;

    public async Task<NotificationHeadDto> HeadAsync(CancellationToken ct)
    {
        var head = await store.HeadAsync(ct);
        var heartbeat = await store.HeartbeatAsync(ct);
        return new(head.NextCursor, head.UnreadCount, head.Enabled, Online(heartbeat), heartbeat);
    }

    public Task<NotificationFeed> FeedAsync(string? after, int limit, CancellationToken ct)
    {
        if (limit is < 1 or > MaxFeedLimit) throw new ProblemException(400, "Invalid notification feed limit.");
        if (after is not null && !NotificationCursor.TryParse(after, out _)) throw new ProblemException(400, "Invalid notification cursor.");
        return store.FeedAsync(after, limit, ct);
    }

    public Task<NotificationPage> PageAsync(NotificationPageQuery query, CancellationToken ct)
    {
        if (query.Tab is not ("unread" or "all") || query.Page < 1 || query.PageSize is < 1 or > 100 ||
            query.Category is not null && query.Category != NotificationValues.Test && !NotificationValues.Categories.Contains(query.Category) ||
            query.Severity is not null && !NotificationValues.Severities.Contains(query.Severity))
            throw new ProblemException(400, "Invalid notification filters or page.");
        return store.PageAsync(query, ct);
    }

    public Task<NotificationClaim> ClaimAsync(CancellationToken ct) =>
        unitOfWork.ExecuteAsync(() => store.ClaimAsync(time.GetUtcNow(), options.PopupWindow, ct), ct);

    public async Task<NotificationDto> ReadAsync(Guid id, CancellationToken ct) =>
        await unitOfWork.ExecuteAsync(() => store.ReadAsync(id, time.GetUtcNow(), ct), ct)
        ?? throw new ProblemException(404, "Notification not found.");

    public Task<int> ReadAllAsync(string? upTo, CancellationToken ct)
    {
        if (!NotificationCursor.TryParse(upTo, out var cursor)) throw new ProblemException(400, "Invalid notification cursor.");
        return unitOfWork.ExecuteAsync(() => store.ReadAllAsync(cursor, time.GetUtcNow(), ct), ct);
    }

    public async Task<NotificationPreferencesDto> PreferencesAsync(CancellationToken ct) =>
        Dto(await store.PreferencesAsync(ct), await store.HeartbeatAsync(ct), await store.SubscriptionHealthAsync(ct));

    public async Task<NotificationPreferencesDto> SavePreferencesAsync(UpdateNotificationPreferencesRequest request, CancellationToken ct)
    {
        var preferences = new NotificationPreferences(request.Enabled, request.MinimumSeverity,
            request.Categories?.ToArray() ?? [], request.ExpectedRevision + 1);
        if (request.Categories is null || !preferences.Valid() || request.ExpectedRevision < 0)
            throw new ProblemException(400, "Invalid notification preferences.");
        var saved = await unitOfWork.ExecuteAsync(() => store.SavePreferencesAsync(preferences, request.ExpectedRevision, time.GetUtcNow(), ct), ct);
        return Dto(saved, await store.HeartbeatAsync(ct), await store.SubscriptionHealthAsync(ct));
    }

    /// <summary>Records a <c>notification.test-requested</c> event; the cooldown is checked and stored in the same transaction.</summary>
    public Task RequestTestAsync(CancellationToken ct) => unitOfWork.ExecuteAsync(async () =>
    {
        var now = time.GetUtcNow();
        if (await store.StartTestAsync(now, options.TestCooldown, ct) is { } wait) throw new NotificationTestCooldownException(wait);
        var run = Guid.CreateVersion7();
        await events.SetRunAsync(run, "owner", ct);
        await events.AppendAsync(new(NotificationRules.TestType, run, $"notification-test:{run:N}", "info", now, now,
            new VesselEventSubject(), new VesselEventSource("owner"), JsonSerializer.SerializeToElement(new { requestedAtUtc = now })), ct);
        return true;
    }, ct);

    private NotificationPreferencesDto Dto(NotificationPreferences preferences, DateTimeOffset? heartbeat, NotificationSubscriptionHealth health) =>
        new(preferences.Enabled, preferences.MinimumSeverity, preferences.Categories, preferences.Revision,
            Online(heartbeat), heartbeat, health.Status, health.FailedDeliveries);

    private bool Online(DateTimeOffset? heartbeat) => heartbeat is { } beat && time.GetUtcNow() - beat <= options.HeartbeatTimeout;
}
