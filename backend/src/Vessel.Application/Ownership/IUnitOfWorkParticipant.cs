namespace Vessel.Application.Ownership;

/// <summary>Participates in the outer transaction; never owns or completes it.</summary>
public interface IUnitOfWorkParticipant
{
    Task BeforeCommitAsync(CancellationToken cancellationToken);
    // Called outside the rollback catch after a successful outer commit.
    Task AfterCommitAsync(CancellationToken cancellationToken);
    Task RollbackAsync(CancellationToken cancellationToken);
}
