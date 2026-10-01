namespace Vessel.Infrastructure.Auth;

public sealed class VesselAuthOptions
{
    public string? Token { get; set; }
    public Guid OwnerId { get; set; } = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public string OwnerName { get; set; } = "Owner";
}
