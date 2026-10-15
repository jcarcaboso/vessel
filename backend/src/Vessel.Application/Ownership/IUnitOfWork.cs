namespace Vessel.Application.Ownership;

/// <summary>
/// Owns a database write boundary on the scoped owner context. Nested calls participate and flush their changes
/// before returning, so the caller reads them and conflicts surface at the nested call; only the outer call commits.
/// Calls within a scope must be sequential and awaited; parallel or fire-and-forget work is unsupported.
/// </summary>
/// <remarks>
/// A failure inside a participant (a nested call, a store write or a store lock wrapper) poisons the whole unit:
/// it cannot be caught and continued. Later participants and the commit are refused and the unit rolls back, even
/// when the caller handled the exception. Keep participating calls out of catch-and-continue <c>try</c> blocks:
/// do the reads and writes a recovery path needs before the guarded external call, or after it outside the
/// <c>catch</c>. Only failures of non-participating work (for example a venue HTTP read) can be handled and recorded.
/// </remarks>
public interface IUnitOfWork
{
    Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken);

    /// <summary>Persists intermediate changes inside the active boundary, without committing.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}
