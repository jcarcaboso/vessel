using System.Security.Claims;
using Vessel.Application.Metadata;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Auth;

namespace Vessel.Api;

public static class SystemEndpoints
{
    public static void MapSystem(this WebApplication app)
    {
        // Database-free: version, owner and venue capabilities for the browser.
        var api = app.MapGroup("/api/system").RequireAuthorization();
        api.MapGet("", (ClaimsPrincipal user, IVenueRegistry venues) => SystemMetadata.ForOwner(JournalOwnerClaims.Owner(user), venues));
    }
}
