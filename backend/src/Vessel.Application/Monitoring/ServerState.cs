namespace Vessel.Application.Monitoring;

public sealed record DueMonitorKey(DateTimeOffset DueAt, Guid OwnerId, Guid AccountId);
public sealed record DueMonitorCandidate(Guid OwnerId, Guid AccountId, string VenueId, DateTimeOffset DueAt)
{
    public DueMonitorKey Key => new(DueAt, OwnerId, AccountId);
}

/// <summary>Lock-free discovery only. Admission always rechecks one candidate in its owner's transaction.</summary>
public interface ISystemMonitorStore
{
    /// <summary>
    /// Due work after <paramref name="after"/> whose due time is at most <paramref name="dueBy"/>, the bound of the
    /// caller's scan cycle, so work rescheduled during a cycle waits for the next one instead of extending it.
    /// </summary>
    Task<IReadOnlyList<DueMonitorCandidate>> DueCandidatesAsync(DueMonitorKey? after, DateTimeOffset dueBy, int limit, CancellationToken ct);
}

public sealed record ServerMonitorHeartbeat(string Deployment, DateTimeOffset HeartbeatAtUtc);
public sealed record MonitorDeployments(IReadOnlyList<string> Ids);

/// <summary>Server-wide state, on independent connections, never an owner's unit of work.</summary>
public interface IServerStateStore
{
    Task<DateTimeOffset?> VenueRetryAtAsync(string venueId, CancellationToken ct);
    Task<IReadOnlyDictionary<string, DateTimeOffset>> VenueRetriesAsync(CancellationToken ct);
    Task DeferVenueAsync(string venueId, DateTimeOffset retryAtUtc, DateTimeOffset now, CancellationToken ct);
    Task<ServerMonitorHeartbeat?> HeartbeatAsync(CancellationToken ct);
    Task RecordHeartbeatAsync(string deployment, DateTimeOffset now, CancellationToken ct);
}
