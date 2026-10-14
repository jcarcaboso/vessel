using System.Security.Claims;
using Vessel.Application.Metadata;

namespace Vessel.Infrastructure.Auth;

/// <summary>The claims that carry the configured owner: issued by <see cref="BearerTokenHandler"/> and read back here only.</summary>
public static class JournalOwnerClaims
{
    public static ClaimsIdentity Identity(Guid ownerId, string ownerName, string authenticationType) => new([
        new Claim(ClaimTypes.NameIdentifier, ownerId.ToString()),
        new Claim(ClaimTypes.Name, ownerName)], authenticationType);

    /// <summary>The authenticated owner's ID. Throws when the principal is not an authenticated owner.</summary>
    public static Guid OwnerId(ClaimsPrincipal? user) =>
        user?.Identity?.IsAuthenticated == true &&
        Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) &&
        id != Guid.Empty ? id : throw MissingOwner();

    /// <summary>The authenticated owner's ID and display name.</summary>
    public static JournalOwner Owner(ClaimsPrincipal? user) =>
        new(OwnerId(user), user!.FindFirstValue(ClaimTypes.Name) is { Length: > 0 } name ? name : throw MissingOwner());

    private static UnauthorizedAccessException MissingOwner() => new("An authenticated owner is required.");
}
