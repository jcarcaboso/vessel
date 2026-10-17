using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Common;

namespace Vessel.Identity;

public static class IdentityHttp
{
    private const int BodyLimit = 16384;

    public static bool PublicRoute(PathString path) => path.Value?.TrimEnd('/').ToLowerInvariant() is
        "/api/auth/config" or "/api/auth/challenge" or "/api/auth/verify" or "/api/auth/register";

    public static void UseVesselIdentity(this WebApplication app)
    {
        var settings = app.Services.GetRequiredService<IdentitySettings>();
        if (!settings.WalletMode) return;
        app.Use(async (context, next) =>
        {
            var request = context.Request;
            var isPublic = PublicRoute(request.Path);
            var signedIn = context.User.Identity?.IsAuthenticated == true;
            if (signedIn && request.Path.StartsWithSegments("/api") && !isPublic &&
                !(HttpMethods.IsGet(request.Method) && request.Path.Equals("/api/auth/session")))
            {
                var user = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (!Guid.TryParse(request.Headers["X-Vessel-User"], out var supplied) || supplied.ToString() != user)
                    throw IdentityErrors.Error(401, "session-user-mismatch");
            }
            if ((isPublic && HttpMethods.IsPost(request.Method)) ||
                (signedIn && request.Path.StartsWithSegments("/api") &&
                    request.Method is "POST" or "PUT" or "PATCH" or "DELETE"))
            {
                if (!settings.AcceptsOrigin(request.Headers.Origin.ToString())) throw IdentityErrors.Error(403, "origin-rejected");
                if (request.Headers.TryGetValue("Sec-Fetch-Site", out var site) && site != "same-origin")
                    throw IdentityErrors.Error(403, "csrf-rejected");
                if (isPublic && request.Headers["X-Vessel-Request"] != "1") throw IdentityErrors.Error(403, "csrf-rejected");
            }
            await next(context);
        });
        app.UseRateLimiter();
    }

    public static IEndpointRouteBuilder MapVesselIdentity(this IEndpointRouteBuilder endpoints)
    {
        var settings = endpoints.ServiceProvider.GetRequiredService<IdentitySettings>();
        var group = endpoints.MapGroup("/api/auth");
        group.MapGet("/config", (string? origin) => settings.WalletMode
            ? Results.Ok((object)new
            {
                mode = "wallet", registration = PolicyName(settings.Registration),
                originAccepted = settings.AcceptsOrigin(IdentitySettings.NormalizeOrigin(origin))
            })
            : Results.Ok((object)new { mode = "token" })).AllowAnonymous();
        if (!settings.WalletMode)
        {
            group.Map("/{**rest}", () => { throw IdentityErrors.Error(404, "not-found"); }).AllowAnonymous();
            return endpoints;
        }
        group.MapPost("/challenge", async (HttpContext context, IdentityService service, IdentityCookies cookies) =>
        {
            var request = await BodyAsync<ChallengeRequest>(context);
            var binding = cookies.BindingToken(context);
            var reused = IdentityTokens.Valid(binding);
            binding = reused ? binding! : IdentityTokens.Create();
            var challenge = await service.ChallengeAsync(request.Address, context.Request.Headers.Origin.ToString(), binding, context.RequestAborted);
            if (!reused) cookies.SetBinding(context, binding);
            return Results.Ok(challenge);
        }).AllowAnonymous();
        group.MapPost("/verify", async (HttpContext context, IdentityService service, IdentityCookies cookies) =>
        {
            var request = await BodyAsync<VerifyRequest>(context);
            var binding = cookies.BindingToken(context);
            var result = await service.VerifyAsync(request, context.Request.Headers.Origin.ToString(), binding,
                cookies.SessionToken(context), context.Request.Headers.UserAgent, context.RequestAborted);
            if (result.SignedIn is { } issued)
            {
                cookies.SetSession(context, issued);
                cookies.ClearBinding(context);
                return Results.Ok((object)new { status = result.Status, session = issued.Session });
            }
            cookies.SetBinding(context, binding!);
            return Results.Ok((object)new
            {
                status = result.Status, registration = result.Registration, requiresInvitation = result.RequiresInvitation, expiresAt = result.ExpiresAt
            });
        }).AllowAnonymous();
        group.MapPost("/register", async (HttpContext context, IdentityService service, IdentityCookies cookies, IdentityRateLimits rates) =>
        {
            var request = await BodyAsync<RegisterRequest>(context);
            if (request.Invitation is not null) rates.CheckInvitation(context);
            var issued = await service.RegisterAsync(request, context.Request.Headers.Origin.ToString(), cookies.BindingToken(context),
                cookies.SessionToken(context), context.Request.Headers.UserAgent, context.RequestAborted);
            cookies.SetSession(context, issued);
            cookies.ClearBinding(context);
            return Results.Json(new { session = issued.Session }, statusCode: 201);
        }).AllowAnonymous();
        group.MapGet("/session", (SessionPrincipal principal) => Results.Ok(principal.Authenticated!.ToDto(settings))).RequireAuthorization();
        group.MapPost("/sign-out", async (HttpContext context, IdentityService service, IdentityCookies cookies, SessionPrincipal principal) =>
        {
            var request = await BodyAsync<SignOutRequest>(context);
            await service.SignOutAsync(principal.Authenticated!, request.ExpectedSessionId, context.RequestAborted);
            cookies.ClearSession(context);
            return Results.NoContent();
        }).RequireAuthorization();
        return endpoints;
    }

    private static string PolicyName(string policy) => policy == "AllowList" ? "allow-list" : policy.ToLowerInvariant();

    private static async Task<T> BodyAsync<T>(HttpContext context)
    {
        if (context.Request.ContentLength > BodyLimit) throw IdentityErrors.Error(413, "request-too-large");
        var buffer = new byte[BodyLimit + 1];
        var count = 0;
        while (count < buffer.Length)
        {
            var read = await context.Request.Body.ReadAsync(buffer.AsMemory(count), context.RequestAborted);
            if (read == 0) break;
            count += read;
        }
        if (count > BodyLimit) throw IdentityErrors.Error(413, "request-too-large");
        try
        {
            return JsonSerializer.Deserialize<T>(buffer.AsSpan(0, count), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? throw IdentityErrors.Error(400, "request-invalid");
        }
        catch (JsonException) { throw IdentityErrors.Error(400, "request-invalid"); }
        catch (BadHttpRequestException) { throw IdentityErrors.Error(400, "request-invalid"); }
    }
}
