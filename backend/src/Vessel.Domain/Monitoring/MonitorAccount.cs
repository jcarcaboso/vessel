using Vessel.Domain.Common;

namespace Vessel.Domain.Monitoring;

/// <summary>Durable admission and fencing, shared by scheduler, Check and account refresh.</summary>
public sealed class MonitorAccount : IOwned
{
    public Guid AccountId { get; set; }
    public Guid OwnerId { get; set; }
    public string State { get; set; } = "idle";
    public int IntervalSeconds { get; set; } = 600;
    public DateTimeOffset? NextRunAtUtc { get; set; }
    public Guid? RequestId { get; set; }
    public string Trigger { get; set; } = "monitor";
    public string ManualState { get; set; } = "idle";
    public DateTimeOffset? NextManualAllowedAtUtc { get; set; }
    public string? LeaseHolder { get; set; }
    public DateTimeOffset? LeaseUntilUtc { get; set; }
    public long Generation { get; set; }
    public DateTimeOffset? LastAttemptAtUtc { get; set; }
    public DateTimeOffset? LastSuccessAtUtc { get; set; }
    public DateTimeOffset? LastObservationAtUtc { get; set; }
    public DateTimeOffset? LastOrdersObservationAtUtc { get; set; }
    public DateTimeOffset? NewestFillAtUtc { get; set; }
    public int ConsecutiveFailures { get; set; }
    public bool HasHistoryGap { get; set; }
    public string? Error { get; set; }
    public string? CredentialRevision { get; set; }
    public DateTimeOffset? ConfirmationAtUtc { get; set; }

    public int RetryAfter(DateTimeOffset now)
    {
        if (ManualState != "idle")
            return Math.Max(1, (int)Math.Ceiling(((LeaseUntilUtc ?? now.AddSeconds(30)) - now).TotalSeconds));
        return NextManualAllowedAtUtc > now
            ? Math.Max(1, (int)Math.Ceiling((NextManualAllowedAtUtc.Value - now).TotalSeconds)) : 0;
    }

    public void Admit(Guid requestId, string trigger, DateTimeOffset now)
    {
        if (requestId == Guid.Empty || RetryAfter(now) != 0)
            throw new InvalidOperationException("Monitor admission is busy or cooling down.");
        RequestId = requestId;
        Trigger = trigger;
        ManualState = "pending";
        if (trigger != "refresh") NextRunAtUtc = now;
    }

    public bool Claim(Guid requestId, string holder, DateTimeOffset now, TimeSpan lease)
    {
        // A delayed command must match the durable request, not create new work.
        if (RequestId != requestId || ManualState == "idle" ||
            LeaseUntilUtc > now && ManualState == "running") return false;
        Generation = checked(Generation + 1);
        LeaseHolder = holder;
        LeaseUntilUtc = now + lease;
        LastAttemptAtUtc = now;
        ManualState = "running";
        return true;
    }

    public bool Owns(long generation, string holder, DateTimeOffset now) =>
        Generation == generation && LeaseHolder == holder && ManualState == "running" && LeaseUntilUtc > now;

    public void Complete(DateTimeOffset now, TimeSpan cooldown, TimeSpan nextDelay, bool success,
        bool degraded = false, bool credentialError = false, string? error = null)
    {
        ManualState = "idle";
        LeaseHolder = null;
        LeaseUntilUtc = null;
        NextManualAllowedAtUtc = now + cooldown;
        NextRunAtUtc = credentialError ? null : now + nextDelay;
        ConsecutiveFailures = success ? 0 : checked(ConsecutiveFailures + 1);
        if (success) LastSuccessAtUtc = now;
        State = credentialError ? "credential-error" : success ? degraded ? "degraded" : "live" :
            ConsecutiveFailures >= 3 ? "stale" : "degraded";
        Error = error;
    }
}

public sealed class MonitorHeartbeat : IOwned
{
    public Guid OwnerId { get; set; }
    public string WorkerId { get; set; } = null!;
    public DateTimeOffset HeartbeatAtUtc { get; set; }
}

/// <summary>A venue throttle applies to every account of this owner, across API and worker processes.</summary>
public sealed class MonitorVenueBudget : IOwned
{
    public Guid OwnerId { get; set; }
    public string VenueId { get; set; } = null!;
    public DateTimeOffset RetryAtUtc { get; set; }
}

/// <summary>Terminal Play exits remain watched until a fresh complete order read establishes absence.</summary>
public sealed class MonitorExitWatch : IOwned
{
    public Guid LinkId { get; set; }
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public Guid PlayId { get; set; }
    public string OrderId { get; set; } = null!;
    public DateTimeOffset LinkRevisionAtUtc { get; set; }
    public DateTimeOffset? ResolvedAtUtc { get; set; }
}
