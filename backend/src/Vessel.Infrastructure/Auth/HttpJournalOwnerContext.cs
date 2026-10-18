using Microsoft.AspNetCore.Http;
using Vessel.Application.Ownership;

namespace Vessel.Infrastructure.Auth;

public sealed class HttpJournalOwnerContext(IHttpContextAccessor accessor, OwnerScopeAssignment assignment) : IJournalOwnerContext
{
    public Guid OwnerId
    {
        get
        {
            var user = accessor.HttpContext?.User;
            var principalOwner = user?.Identity?.IsAuthenticated == true ? JournalOwnerClaims.OwnerId(user) : (Guid?)null;
            if (assignment.OwnerId is not { } assigned)
                return principalOwner ?? throw new UnauthorizedAccessException("An authenticated or assigned owner is required.");
            if (principalOwner is { } claimed && claimed != assigned)
                throw new UnauthorizedAccessException("The assigned and authenticated owners differ.");
            return assigned;
        }
    }
}
