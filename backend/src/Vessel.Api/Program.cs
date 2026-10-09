using System.Security.Claims;
using Vessel.Api;
using Vessel.Application.Workspace;
using Vessel.Application.System;
using Vessel.Infrastructure;
using Vessel.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddVesselInfrastructure(builder.Configuration);
builder.Services.AddVesselPersistence(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);

var app = builder.Build();
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
            BadHttpRequestException => (400, "The request body or parameters are invalid."),
            _ when SafeExceptionDiagnostics.IsDependencyOutage(ex) => (503, "The service is unavailable. Try again later."),
            _ => (500, "An unexpected error occurred.")
        };
        if (!expected)
            SafeExceptionDiagnostics.Log(app.Logger, context, ex, traceId, status);
        if (context.Response.HasStarted) throw;
        context.Response.Clear();
        context.Response.Headers["X-Correlation-ID"] = traceId;
        await Results.Problem(statusCode: status, detail: detail,
            extensions: new Dictionary<string, object?> { ["traceId"] = traceId }).ExecuteAsync(context);
    }
});
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health/live", () => Results.Ok(new { status = "healthy" })).AllowAnonymous();
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
