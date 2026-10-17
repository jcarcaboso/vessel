using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Vessel.Identity;

public static partial class IdentityHttp
{
    private static void MapAccountEndpoints(RouteGroupBuilder group)
    {
        group.MapGet("/sessions", async (IdentityAccountService service, SessionPrincipal principal, CancellationToken ct) =>
            Results.Ok(await service.SessionsAsync(principal.Authenticated!, ct))).RequireAuthorization();
        group.MapDelete("/sessions/{id}", async (Guid id, HttpContext context, IdentityAccountService service,
            SessionPrincipal principal, IdentityCookies cookies) =>
        {
            if (await service.RevokeSessionAsync(principal.Authenticated!, id, context.RequestAborted)) cookies.ClearSession(context);
            return Results.NoContent();
        }).RequireAuthorization();
        group.MapPost("/sessions/revoke-others", async (IdentityAccountService service, SessionPrincipal principal, CancellationToken ct) =>
        {
            await service.RevokeOthersAsync(principal.Authenticated!, ct);
            return Results.NoContent();
        }).RequireAuthorization();
        group.MapPatch("/profile", async (HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
            Results.Ok(await service.UpdateProfileAsync(principal.Authenticated!, await BodyAsync<ProfileRequest>(context),
                context.RequestAborted))).RequireAuthorization();
        group.MapGet("/wallets", async (IdentityAccountService service, SessionPrincipal principal, CancellationToken ct) =>
            Results.Ok(await service.WalletsAsync(principal.Authenticated!, ct))).RequireAuthorization();
        group.MapPost("/step-up/challenge", async (HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
            Results.Ok(await service.StepUpChallengeAsync(principal.Authenticated!, await BodyAsync<StepUpChallengeRequest>(context),
                context.Request.Headers.Origin.ToString(), context.RequestAborted))).RequireAuthorization();
        group.MapPost("/step-up", async (HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
        {
            await service.StepUpAsync(principal.Authenticated!, await BodyAsync<StepUpRequest>(context),
                context.Request.Headers.Origin.ToString(), context.RequestAborted);
            return Results.NoContent();
        }).RequireAuthorization();
        group.MapPost("/wallets/challenge", async (HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
            Results.Ok(await service.WalletChallengeAsync(principal.Authenticated!, await BodyAsync<ChallengeRequest>(context),
                context.Request.Headers.Origin.ToString(), context.RequestAborted))).RequireAuthorization();
        group.MapPost("/wallets", async (HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
            Results.Json(await service.LinkWalletAsync(principal.Authenticated!, await BodyAsync<LinkWalletRequest>(context),
                context.Request.Headers.Origin.ToString(), context.RequestAborted), statusCode: 201)).RequireAuthorization();
        group.MapPatch("/wallets/{id}", async (Guid id, HttpContext context, IdentityAccountService service, SessionPrincipal principal) =>
            Results.Ok(await service.UpdateWalletAsync(principal.Authenticated!, id, await BodyAsync<WalletLabelRequest>(context),
                context.RequestAborted))).RequireAuthorization();
        group.MapDelete("/wallets/{id}", async (Guid id, HttpContext context, IdentityAccountService service,
            SessionPrincipal principal, IdentityCookies cookies) =>
        {
            if (await service.RemoveWalletAsync(principal.Authenticated!, id, context.RequestAborted)) cookies.ClearSession(context);
            return Results.NoContent();
        }).RequireAuthorization();
    }
}
