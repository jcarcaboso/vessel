namespace Vessel.Application.Ownership;

/// <summary>
/// Owns a database write boundary on the scoped owner context. Nested calls participate;
/// only the outer call saves and commits. A failed participant makes the whole operation fail.
/// Calls within a scope must be sequential and awaited; parallel or fire-and-forget work is unsupported.
/// </summary>
public interface IUnitOfWork
{
    Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken);

    /// <summary>Persists intermediate changes inside the active boundary, without committing.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}
