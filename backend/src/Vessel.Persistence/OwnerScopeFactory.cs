using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Ownership;

namespace Vessel.Persistence;

/// <summary>Assigns a fresh scope before exposing any owner-bound services.</summary>
public sealed class OwnerScopeFactory(IServiceScopeFactory scopes) : IOwnerScopeFactory
{
    public IOwnerScope Create(Guid ownerId)
    {
        if (ownerId == Guid.Empty) throw new ArgumentException("Owner ID must be nonempty.", nameof(ownerId));
        var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<OwnerScopeAssignment>().Assign(ownerId);
        return new OwnerScope(ownerId, scope);
    }

    private sealed class OwnerScope(Guid ownerId, AsyncServiceScope scope) : IOwnerScope
    {
        public Guid OwnerId => ownerId;
        public IServiceProvider Services => scope.ServiceProvider;
        public ValueTask DisposeAsync() => scope.DisposeAsync();
    }
}

/// <summary>Owner context for containers without HTTP, including offline messaging commands.</summary>
public sealed class AssignedOwnerContext(OwnerScopeAssignment assignment) : IJournalOwnerContext
{
    public Guid OwnerId => assignment.OwnerId ?? throw new UnauthorizedAccessException("An assigned owner is required.");
}
