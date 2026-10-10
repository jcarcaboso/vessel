using System.Security.Claims;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Vessel.Api;
using Vessel.Application.Workspace;
using Vessel.Application.System;
using Vessel.Infrastructure;
using Vessel.Persistence;

var builder = WebApplication.CreateBuilder(args);
if (!builder.Environment.IsDevelopment()) ProductionConfiguration.Validate(builder.Configuration);
builder.Services.AddVesselInfrastructure(builder.Configuration);
builder.Services.AddVesselPersistence(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);

// Only loopback proxies (the defaults) may report the original scheme and client, so a TLS-terminating
// proxy on the same host is recognised and a remote client cannot claim HTTPS with a header.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

var app = builder.Build();
app.UseForwardedHeaders();
// Every response is API data or an image; none should be framed, sniffed or leak the page as a referrer.
// Applied when the response starts, so error responses rebuilt after Response.Clear() carry them too.
app.Use((context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers.XFrameOptions = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        // Owner data must not linger in browser or proxy caches; endpoints may set a stricter policy.
        if (context.Request.Path.StartsWithSegments("/api") && !headers.ContainsKey("Cache-Control"))
            headers.CacheControl = "no-store";
        return Task.CompletedTask;
    });
    return next(context);
});
// Do not let provider/DB details or development exception pages escape the API.
app.Use(async (context, next) =>
{
    try { await next(context); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception ex)
    {
        var expected = ex is WorkspaceException or BadHttpRequestException;
        // Generate locally: neither a correlation header nor a raw URL is diagnostic input.
        var traceId = System.Diagnostics.ActivityTraceId.CreateRandom().ToString();
        var (status, detail) = ex switch
        {
            WorkspaceException error => (error.StatusCode, error.Message),
            BadHttpRequestException { StatusCode: 413 } => (413, "The request body is too large."),
            BadHttpRequestException => (400, "The request body or parameters are invalid."),
            _ when SafeExceptionDiagnostics.IsDependencyOutage(ex) => (503, "The service is unavailable. Try again later."),
            _ => (500, "An unexpected error occurred.")
        };
        if (!expected)
            SafeExceptionDiagnostics.Log(app.Logger, context, ex, traceId, status);
        if (context.Response.HasStarted) throw;
        context.Response.Clear();
        if (context.Request.Path.Value?.TrimEnd('/').EndsWith("/credential", StringComparison.OrdinalIgnoreCase) == true)
            context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Correlation-ID"] = traceId;
        await Results.Problem(statusCode: status, detail: detail,
            extensions: new Dictionary<string, object?> { ["traceId"] = traceId }).ExecuteAsync(context);
    }
});
app.UseAuthentication();
app.UseAuthorization();
// Bound credential JSON before model binding, including chunked requests. Never log its body.
app.Use(async (context, next) =>
{
    if (context.Request.Path.Value?.TrimEnd('/').EndsWith("/credential", StringComparison.OrdinalIgnoreCase) == true)
    {
        context.Response.Headers.CacheControl = "no-store";
        // The browser blocks token entry on plaintext LAN origins; enforce it here too for other clients.
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsDelete(context.Request.Method) &&
            !CredentialTransport.IsAllowed(context))
            throw new WorkspaceException(403, "Credential entry requires HTTPS outside localhost.");
        var limit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = 4096;
        if (context.Request.ContentLength > 4096)
            throw new WorkspaceException(413, "Credential request is too large.");
    }
    await next(context);
});

app.MapGet("/health/live", () => Results.Ok(new { status = "healthy" })).AllowAnonymous();
// Readiness for a proxy or orchestrator: the database answers and every migration is applied. No details.
app.MapGet("/health/ready", async (IServiceProvider services, CancellationToken ct) =>
{
    try
    {
        var db = services.GetRequiredService<VesselDbContext>();
        var ready = await db.Database.CanConnectAsync(ct) && !(await db.Database.GetPendingMigrationsAsync(ct)).Any();
        return ready ? Results.Ok(new { status = "ready" }) : Results.Json(new { status = "unavailable" }, statusCode: 503);
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        return Results.Json(new { status = "unavailable" }, statusCode: 503);
    }
}).AllowAnonymous();
app.MapGet("/api/system", (ClaimsPrincipal user, Vessel.Application.Venues.IVenueRegistry venues) => SystemMetadata.ForOwner(new JournalOwner(
    Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!), user.FindFirstValue(ClaimTypes.Name)!), venues))
    .RequireAuthorization();
app.MapWorkspace();
app.MapEvidence();
app.MapPlays();
app.MapSizing();
app.MapReview();
if (app.Environment.IsDevelopment()) app.MapOpenApi().RequireAuthorization();

app.Run();

public partial class Program;
