namespace Vessel.Domain.Common;

/// <summary>
/// A record that belongs to one owner. Persistence filters every read and rejects every write by this owner,
/// and refuses to build a model containing an entity that does not implement it.
/// </summary>
public interface IOwned
{
    Guid OwnerId { get; }
}
