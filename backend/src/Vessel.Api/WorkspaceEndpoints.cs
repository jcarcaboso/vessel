using Vessel.Application.Workspace;

namespace Vessel.Api;

public static class WorkspaceEndpoints
{
    public static void MapWorkspace(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization();
        api.MapGet("/portfolios", async (WorkspaceService service, CancellationToken ct) =>
            Results.Ok((await service.OverviewAsync(ct)).Portfolios));
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
            Results.Ok((await service.OverviewAsync(ct)).Accounts));
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
        api.MapPost("/accounts/{id:guid}/sync", async (Guid id, WorkspaceService service, CancellationToken ct) =>
            Results.Ok(await service.SyncAsync(id, ct)));
        api.MapGet("/overview", async (WorkspaceService service, CancellationToken ct) => Results.Ok(await service.OverviewAsync(ct)));
    }
}
