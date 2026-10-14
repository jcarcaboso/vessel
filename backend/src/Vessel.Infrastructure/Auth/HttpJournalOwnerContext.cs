using Microsoft.AspNetCore.Http;
using Vessel.Application.Ownership;

namespace Vessel.Infrastructure.Auth;

public sealed class HttpJournalOwnerContext(IHttpContextAccessor accessor) : IJournalOwnerContext
{
    public Guid OwnerId => JournalOwnerClaims.OwnerId(accessor.HttpContext?.User);
}
