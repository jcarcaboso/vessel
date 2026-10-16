using System.Text.Json;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;

namespace Vessel.Application.Monitoring;

public sealed record MonitorDiscrepancyDto(Guid Id, Guid AccountId, Guid? PlayId, string ContractId, string Kind,
    string Severity, string State, DateTimeOffset OpenedAtUtc, DateTimeOffset? ConfirmedAtUtc,
    DateTimeOffset? ResolvedAtUtc, DateTimeOffset? DismissedAtUtc, string? Note, JsonElement Details);
public sealed record AccountMonitorDto(Guid AccountId, string State, DateTimeOffset? LastAttemptAtUtc,
    DateTimeOffset? LastSuccessAtUtc, DateTimeOffset? NextRunAtUtc, string ManualState,
    DateTimeOffset? NextManualAllowedAtUtc, string? Error, bool WorkerOnline, IReadOnlyList<MonitorDiscrepancyDto> Discrepancies);
public sealed record MonitorSummaryDto(bool WorkerOnline, DateTimeOffset? HeartbeatAtUtc, IReadOnlyList<AccountMonitorDto> Accounts);
public sealed record MonitorRunAccepted(Guid RequestId, AccountMonitorDto Monitor);

public sealed class MonitorAdmissionException(int retryAfter) : Exception("This account check is running or cooling down.")
{
    public int RetryAfter { get; } = retryAfter;
}

// Credential revision is a one-way digest of encrypted storage, never credential plaintext.
public sealed record MonitorCapture(Account Account, string? CredentialRevision, DateTimeOffset? CredentialExpiresAtUtc,
    DateTimeOffset? NewestRetainedFillAtUtc = null);
public sealed record MonitorLease(Guid AccountId, Guid RequestId, long Generation, string WorkerId, string Trigger);
public sealed record MonitorRead(PerpetualVenueReadResult Sync, VenueOrderReadResult? Orders,
    string? OrderError = null, bool CredentialError = false);
public sealed record MonitorEvaluation(Guid RunId, Account Account, MonitorRead Read, DateTimeOffset? PreviousSuccessAtUtc,
    DateTimeOffset? NewestFillBeforeReadUtc, bool HistoryGap, string Trigger);
public sealed record MonitorEvaluationResult(DateTimeOffset? NextConfirmationAtUtc, bool Incomplete = false, string? SafeNotice = null);

/// <summary>Called inside the fenced account unit of work, after imports and execution reconciliation.</summary>
public interface IMonitorEvaluator
{
    /// <returns>A confirmation deadline, if another fresh account-wide observation is needed.</returns>
    Task<MonitorEvaluationResult> EvaluateAsync(MonitorEvaluation observation, CancellationToken ct);
    Task<IReadOnlyList<MonitorDiscrepancyDto>> ReadAsync(Guid accountId, Guid? playId, CancellationToken ct);
}

public interface IMonitorImporter
{
    Task RetainAsync(Account account, VenueOrderReadResult orders, CancellationToken ct);
    Task ReconcileAsync(Account account, VenueOrderReadResult orders, IReadOnlyList<VenueInstrument> instruments, CancellationToken ct);
}

/// <summary>One account's discovery inputs, read set-based; only rows whose scheduling changes are then locked.</summary>
public sealed record MonitorCandidate(Guid AccountId, string VenueId, bool Monitorable, bool Eligible, bool HasExpiredWatches,
    string? CredentialRevision, MonitorAccount? Row);

/// <summary>A linked exit watched after its Play ended. <paramref name="State"/>: watching, resolved or unverifiable.</summary>
public sealed record MonitorWatchDto(Guid LinkId, Guid PlayId, string OrderId, string State, DateTimeOffset StartedAtUtc,
    DateTimeOffset? EndedAtUtc);

public interface IMonitorStore
{
    Task<MonitorCapture?> CaptureAsync(Guid accountId, CancellationToken ct);
    /// <summary>Monitor rows of enabled, currently eligible accounts on the given venues, bounded, in one read.</summary>
    Task<IReadOnlyList<(MonitorAccount Row, string VenueId)>> SummaryAsync(IReadOnlyCollection<string> venueIds,
        DateTimeOffset now, CancellationToken ct);
    Task<MonitorAccount?> FindAsync(Guid accountId, CancellationToken ct);
    Task<DateTimeOffset?> VenueRetryAtAsync(string venueId, CancellationToken ct);
    Task<IReadOnlyDictionary<string, DateTimeOffset>> VenueRetriesAsync(CancellationToken ct);
    /// <summary>
    /// Persists the maximum Retry-After deadline, independently of any account lease. The deadline is clamped to at
    /// most <see cref="VenueRateLimitException.MaxDelay"/> after <paramref name="now"/> before it is stored.
    /// </summary>
    Task DeferVenueAsync(string venueId, DateTimeOffset retryAtUtc, DateTimeOffset now, CancellationToken ct);
    Task<MonitorHeartbeat?> HeartbeatAsync(CancellationToken ct);
    Task RecordHeartbeatAsync(string workerId, DateTimeOffset now, CancellationToken ct);
    /// <summary>Accounts that may need scheduling changes: monitorable ones, and any with a non-idle monitor row.</summary>
    Task<IReadOnlyList<MonitorCandidate>> DiscoveryCandidatesAsync(IReadOnlyCollection<string> venueIds, DateTimeOffset now,
        CancellationToken ct);
    Task<bool> EligibleAsync(Guid accountId, DateTimeOffset now, CancellationToken ct);
    Task<T> LockedAsync<T>(Guid accountId, Func<Account, MonitorAccount, Task<T>> action, CancellationToken ct);
    Task<IReadOnlyList<MonitorLease>> ClaimDueAsync(string workerId, DateTimeOffset now, int limit, CancellationToken ct);
    Task<MonitorLease?> ClaimAsync(Guid accountId, Guid requestId, string workerId, DateTimeOffset now, CancellationToken ct);
    Task<bool> RenewAsync(MonitorLease lease, DateTimeOffset now, CancellationToken ct);
    /// <summary>
    /// Inside the account lock. With <paramref name="orders"/>, a reported terminal status ends a watch whatever the
    /// read's completeness, and absence ends it only on a complete open-order read. Watches past their lifetime end
    /// <c>unverifiable</c>, with or without a read.
    /// </summary>
    Task UpdateWatchesAsync(Guid accountId, VenueOrderReadResult? orders, DateTimeOffset now, CancellationToken ct);
    Task<IReadOnlyList<MonitorWatchDto>> WatchesAsync(Guid playId, DateTimeOffset now, CancellationToken ct);
    /// <summary>Inside account admission transaction. Serializes the two-read budget across API and workers.</summary>
    Task<bool> ReadCapacityAsync(DateTimeOffset now, CancellationToken ct);
}
