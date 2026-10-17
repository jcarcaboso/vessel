namespace Vessel.Application.Ownership;

/// <summary>How background work treats an owner. Unknown means no such user: its messages are dead-lettered.</summary>
public enum JournalOwnerStatus
{
    Unknown,
    Active,
    Suspended,
}

/// <summary>
/// Which journal owners exist and whether their background work may run. Token mode serves the one configured owner
/// (<see cref="ConfiguredOwnerDirectory"/>); Wallet mode is implemented by the identity module. Retained-data
/// maintenance (event retention) enumerates owners from journal data instead, so suspended owners keep being pruned.
/// </summary>
public interface IJournalOwnerDirectory
{
    Task<JournalOwnerStatus> StatusAsync(Guid ownerId, CancellationToken cancellationToken);

    /// <summary>Active owners in ascending ID order after <paramref name="after"/> (exclusive), at most <paramref name="limit"/>.</summary>
    Task<IReadOnlyList<Guid>> ActiveOwnersAsync(Guid? after, int limit, CancellationToken cancellationToken);
}

/// <summary>Token mode: the single configured owner is the only owner and is always active.</summary>
public sealed class ConfiguredOwnerDirectory(Guid ownerId) : IJournalOwnerDirectory
{
    private readonly Guid owner = ownerId != Guid.Empty ? ownerId : throw new ArgumentException("Owner ID must be nonempty.", nameof(ownerId));

    public Task<JournalOwnerStatus> StatusAsync(Guid ownerId, CancellationToken cancellationToken) =>
        Task.FromResult(ownerId == owner ? JournalOwnerStatus.Active : JournalOwnerStatus.Unknown);

    public Task<IReadOnlyList<Guid>> ActiveOwnersAsync(Guid? after, int limit, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        IReadOnlyList<Guid> owners = after is { } last && last.CompareTo(owner) >= 0 ? [] : [owner];
        return Task.FromResult(owners);
    }
}
