using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Vessel.Application.Ownership;

namespace Vessel.Infrastructure.Auth;

public sealed class HttpJournalOwnerContext(IHttpContextAccessor accessor) : IJournalOwnerContext
{
    public Guid OwnerId =>
        accessor.HttpContext?.User.Identity?.IsAuthenticated == true &&
        Guid.TryParse(accessor.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) &&
        id != Guid.Empty ? id : throw new UnauthorizedAccessException("An authenticated owner is required.");
}
