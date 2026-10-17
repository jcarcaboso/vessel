namespace Vessel.Application.Ownership;

/// <summary>
/// The owner an <see cref="IOwnerScopeFactory"/> scope was created for. Registered as a scoped service; the factory
/// assigns it once, right after creating the scope and before exposing its services. The journal owner context
/// returns it when set, otherwise the authenticated HTTP principal, and throws when both are present and differ.
/// </summary>
public sealed class OwnerScopeAssignment
{
    public Guid? OwnerId { get; private set; }

    public void Assign(Guid ownerId)
    {
        if (ownerId == Guid.Empty) throw new ArgumentException("Owner ID must be nonempty.", nameof(ownerId));
        if (OwnerId is not null) throw new InvalidOperationException("The scope owner is already assigned.");
        OwnerId = ownerId;
    }
}
