namespace Vessel.Application.Ownership;

/// <summary>
/// Creates a service scope whose <see cref="IJournalOwnerContext"/> is the given owner. Background code (worker,
/// messaging listeners, maintenance, monitor renewals) creates scopes only through this, never through a plain
/// scope factory, so no scope runs without an owner or with the wrong one.
/// </summary>
public interface IOwnerScopeFactory
{
    IOwnerScope Create(Guid ownerId);
}

/// <summary>A service scope bound to one owner. Dispose it asynchronously.</summary>
public interface IOwnerScope : IAsyncDisposable
{
    Guid OwnerId { get; }
    IServiceProvider Services { get; }
}
