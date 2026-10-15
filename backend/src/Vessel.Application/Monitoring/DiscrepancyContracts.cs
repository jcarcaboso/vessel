using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Monitoring;

public sealed record DismissMonitorDiscrepancyRequest(string? Note = null);

/// <summary>Retained facts, including suggested links. A bounded load must report any omitted facts.</summary>
/// <param name="AssignmentLinks">Account-wide linked or suggested orders, including retrospective Plays.
/// Separate from the links used to evaluate monitored planned Plays; null means unknown.</param>
/// <param name="AssignmentLinksComplete">True only when all account-wide assignment links were loaded.
/// A capped or unknown load cannot establish or clear an unlinked-fill discrepancy.</param>
public sealed record MonitorDiscrepancyFacts(IReadOnlyList<Play> Plays, IReadOnlyList<PlayOrderLink> Links,
    IReadOnlyList<ImportedOrder> Orders, IReadOnlyList<ImportedFill> Fills, bool Complete = true,
    IReadOnlyList<PlayOrderLink>? AssignmentLinks = null, bool AssignmentLinksComplete = false);

public interface IMonitorDiscrepancyStore
{
    Task<Account?> AccountAsync(Guid accountId, CancellationToken ct);
    Task<Play?> PlayAsync(Guid playId, CancellationToken ct);
    Task<MonitorDiscrepancyFacts> LoadAsync(Guid accountId, CancellationToken ct);
    Task<IReadOnlyList<PlayDiscrepancy>> RecordsAsync(Guid accountId, CancellationToken ct);
    void Add(PlayDiscrepancy record);
    /// <summary>Serializes dismissal with the monitor account fence. Requires an active unit of work.</summary>
    Task LockAsync(Guid accountId, CancellationToken ct);
}
