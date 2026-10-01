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
        if (context.Response.HasStarted) throw;
        var (status, detail) = ex switch
        {
            WorkspaceException error => (error.StatusCode, error.Message),
            BadHttpRequestException => (400, "The request body or parameters are invalid."),
            _ => (503, "The service is unavailable. Try again later.")
        };
        context.Response.Clear();
        await Results.Problem(statusCode: status, detail: detail).ExecuteAsync(context);
    }
});
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health/live", () => Results.Ok(new { status = "healthy" })).AllowAnonymous();
app.MapGet("/api/system", (ClaimsPrincipal user) => SystemMetadata.ForOwner(new JournalOwner(
    Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!), user.FindFirstValue(ClaimTypes.Name)!)))
    .RequireAuthorization();
app.MapWorkspace();
if (app.Environment.IsDevelopment()) app.MapOpenApi().RequireAuthorization();

app.Run();

public partial class Program;
