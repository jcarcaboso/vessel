namespace Vessel.Infrastructure.Auth;

public sealed class VesselAuthOptions
{
    public string? Token { get; set; }
    public Guid OwnerId { get; set; } = Vessel.Application.Ownership.JournalOwner.Default;
    public string OwnerName { get; set; } = "Owner";
}
