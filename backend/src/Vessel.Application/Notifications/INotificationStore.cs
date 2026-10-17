using Vessel.Application.Events;

namespace Vessel.Application.Notifications;

/// <summary>An event a notification covers, or one handled without a notification (a withdrawal or generation marker).</summary>
public sealed record NotificationSource(Guid EventId, string EventType, Guid? AccountId, string? Subject = null,
    long? Generation = null, string? Revision = null, string? Transition = null);

/// <summary>An earlier source of the same subject, with the state of its notification's in-app delivery if it has one.</summary>
public sealed record NotificationSubjectSource(Guid EventId, Guid? NotificationId, long Generation, string? Revision,
    string? Transition, string? DeliveryState);

public sealed record NewNotification(Guid Id, NotificationKind Kind, string Category, string Severity, Guid? AccountId,
    Guid? PlayId, Guid? RunId, NotificationContent Content, DateTimeOffset OccurredAt, DateTimeOffset DetectedAt,
    IReadOnlyList<NotificationSource> Sources);

/// <summary>What relevance needs about a standalone subject, read without locks and without opening any token.</summary>
public sealed record NotificationSubjectState(bool Exists, string? CurrentRevision, DateTimeOffset? ExpiresAt = null);

/// <summary>
/// The hub's persistence. Every call runs inside the dispatcher's unit of work. Lock order: run or subject advisory
/// lock, then the owner's notification cursor (taken by the first mutation), then notification and delivery rows.
/// </summary>
public interface INotificationHubStore
{
    Task LockAsync(string key, CancellationToken ct);
    Task<bool> HandledAsync(Guid eventId, CancellationToken ct);
    Task<NotificationPreferences> PreferencesAsync(CancellationToken ct);
    /// <summary>
    /// Retained events of the run and account that no source covers, after <paramref name="afterSequence"/>, in sequence
    /// order, at most <paramref name="limit"/>.
    /// </summary>
    Task<IReadOnlyList<VesselEvent>> RunCandidatesAsync(Guid runId, Guid? accountId, long afterSequence, int limit, CancellationToken ct);
    Task<NotificationContext?> ContextAsync(Guid? accountId, IReadOnlyCollection<Guid> playIds, CancellationToken ct);
    /// <summary>Still <c>suggested</c>, its Play still Planned, Paused or Open, and its order not linked elsewhere.</summary>
    Task<bool> LinkActionableAsync(Guid linkId, CancellationToken ct);
    Task<NotificationSubjectState> SubjectStateAsync(NotificationIdentity identity, CancellationToken ct);
    Task<IReadOnlyList<NotificationSubjectSource>> SubjectSourcesAsync(string subject, CancellationToken ct);
    /// <summary>Unread in-app deliveries of these notifications become withdrawn. Returns how many changed.</summary>
    Task<int> WithdrawAsync(IReadOnlyCollection<Guid> notificationIds, CancellationToken ct);
    /// <summary>
    /// Creates the notification and its unread in-app delivery after rechecking, under the cursor lock, that its
    /// account is still enabled. Returns false (recording the sources as handled) when it no longer is.
    /// </summary>
    Task<bool> CreateAsync(NewNotification notification, CancellationToken ct);
    Task RecordHandledAsync(IReadOnlyList<NotificationSource> sources, CancellationToken ct);
}
