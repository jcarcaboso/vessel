using Vessel.Application.MarketData;
using Vessel.Application.Workspace;
using Vessel.Application.Credentials;

namespace Vessel.Api;

public static class WorkspaceEndpoints
{
    public static void MapWorkspace(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization();
        api.MapGet("/venues/{venueId}/accounts", async (string venueId, string? address, AccountDiscoveryService service, CancellationToken ct) =>
            Results.Ok(await service.DiscoverAsync(venueId, address, ct)));
        // This read-only preview never stores the token. The credential suffix applies the same
        // no-store and bounded-body middleware as credential saves; tokens never enter a URL.
        api.MapPost("/venues/{venueId}/accounts/credential",
            async (string venueId, CredentialDiscoveryRequest request, AccountDiscoveryService service, CancellationToken ct) =>
                Results.Ok(await service.DiscoverAsync(venueId, request, ct)));
        var credential = api.MapGroup("/accounts/{id:guid}/credential");
        credential.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            return await next(context);
        });
        credential.MapGet("", async (Guid id, AccountCredentialService service, CancellationToken ct) =>
            Results.Ok(await service.GetAsync(id, ct)));
        credential.MapPut("", async (Guid id, SaveAccountCredentialRequest request, AccountCredentialService service, CancellationToken ct) =>
            Results.Ok(await service.PutAsync(id, request, ct)));
        credential.MapDelete("", async (Guid id, AccountCredentialService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });
        api.MapGet("/portfolios", async (WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.PortfoliosAsync(ct)));
        api.MapGet("/portfolios/{id:guid}", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.PortfolioAsync(id, ct)));
        api.MapPost("/portfolios", async (CreatePortfolioRequest request, WorkspaceService service, CancellationToken ct) =>
        {
            var result = await service.CreatePortfolioAsync(request, ct);
            return Results.Created($"/api/portfolios/{result.Id}", result);
        });
        api.MapPatch("/portfolios/{id:guid}", async (Guid id, RenamePortfolioRequest request, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.RenamePortfolioAsync(id, request, ct)));
        api.MapDelete("/portfolios/{id:guid}", async (Guid id, WorkspaceService service, CancellationToken ct) =>
        {
            await service.DeletePortfolioAsync(id, ct);
            return Results.NoContent();
        });
        api.MapPut("/accounts/{id:guid}", async (Guid id, UpdateAccountRequest request, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.UpdateAccountAsync(id, request, ct)));
        api.MapDelete("/accounts/{id:guid}", async (Guid id, WorkspaceService service, CancellationToken ct) =>
        {
            await service.DeleteAccountAsync(id, ct);
            return Results.NoContent();
        });
        api.MapGet("/accounts", async (WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.AccountsAsync(ct)));
        api.MapGet("/accounts/{id:guid}", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.AccountAsync(id, ct)));
        api.MapPost("/accounts", async (CreateAccountRequest request, WorkspaceService service, CancellationToken ct) =>
        {
            var result = await service.CreateAccountAsync(request, ct);
            return Results.Created($"/api/accounts/{result.Id}", result);
        });
        api.MapGet("/accounts/{id:guid}/snapshot", async (Guid id, WorkspaceService service, CancellationToken ct) =>
        {
            var result = await service.SnapshotAsync(id, ct);
            // Results.Ok(null) emits an empty body; the contract requires literal JSON null.
            return result is null ? Results.Text("null", "application/json") : Results.Ok(result);
        });
        api.MapGet("/accounts/{id:guid}/fills", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.FillsAsync(id, ct)));
        api.MapGet("/accounts/{id:guid}/instruments", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.InstrumentsAsync(id, ct)));
        api.MapGet("/accounts/{id:guid}/candles", async (Guid id, string? instrument, string? interval, long? endTime,
            CandleService service, CancellationToken ct) =>
            Results.Ok(await service.CandlesAsync(id, instrument, interval, endTime, ct)));
        api.MapGet("/accounts/{id:guid}/market-context", async (Guid id, string? instrument,
            MarketContextService service, CancellationToken ct) =>
            Results.Ok(await service.ContextAsync(id, instrument, ct)));
        api.MapGet("/accounts/{id:guid}/market-stream", MarketStreamEndpoint.StreamAsync);
        api.MapPost("/accounts/{id:guid}/sync", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.SyncAsync(id, ct)));
        api.MapGet("/overview", async (WorkspaceService service, CancellationToken ct) => Results.Ok(await service.OverviewAsync(ct)));
    }
}
