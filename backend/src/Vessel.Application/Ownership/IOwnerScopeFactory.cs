namespace Vessel.Application.Ownership;

/// <summary>
/// Creates a service scope whose <see cref="IJournalOwnerContext"/> is the given owner. Background code (worker,
/// messaging listeners, maintenance, monitor renewals) creates scopes only through this, never through a plain
/// scope factory, so no scope runs without an owner or with the wrong one.
/// </summary>
public interface IOwnerScopeFactory
{
    /// <summary>
    /// Creates a fresh scope and assigns its <see cref="OwnerScopeAssignment"/> before returning. Rejects an empty
    /// owner. Never consults the owner directory: callers decide whether the owner's work may run (retention,
    /// renewals and settlement still run for suspended owners).
    /// </summary>
    IOwnerScope Create(Guid ownerId);
}

/// <summary>A service scope bound to one owner. Dispose it asynchronously.</summary>
public interface IOwnerScope : IAsyncDisposable
{
    Guid OwnerId { get; }
    IServiceProvider Services { get; }
}
