namespace Vessel.Persistence;

/// <summary>
/// Lets infrastructure adapters outside Persistence (the messaging outbox) join the exact unit of work that owns
/// a context. A raw EF transaction or a closed callback conveys no authority and is rejected.
/// </summary>
public static class UnitOfWorkParticipation
{
    public static void RequireActive(VesselDbContext context) => UnitOfWork.ForCurrentContext(context).RequireActive();

    public static Task<T> RunAsync<T>(VesselDbContext context, Func<Task<T>> operation, CancellationToken cancellationToken) =>
        UnitOfWork.ForCurrentContext(context).ParticipateAsync(operation, cancellationToken);
}
