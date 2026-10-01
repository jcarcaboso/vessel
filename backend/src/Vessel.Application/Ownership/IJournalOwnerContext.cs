namespace Vessel.Application.Ownership;

// Supplied by authenticated infrastructure, never by an API request body.
public interface IJournalOwnerContext
{
    Guid OwnerId { get; }
}
