using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;

namespace Vessel.Api;

public static class PlayEndpoints
{
    public static void MapPlays(this WebApplication app)
    {
        var api = app.MapGroup("/api/plays").RequireAuthorization();
        api.MapGet("", async (PlayService service, CancellationToken ct) => Results.Ok(await service.ListAsync(ct)));
        api.MapPost("", async (CreatePlayRequest request, PlayService service, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(request, ct);
            return Results.Created($"/api/plays/{result.Summary.Id}", result);
        });
        api.MapGet("/{id:guid}", async (Guid id, PlayService service, CancellationToken ct) => Results.Ok(await service.GetAsync(id, ct)));
        api.MapPut("/{id:guid}", async (Guid id, UpdatePlayRequest request, PlayService service, CancellationToken ct) =>
            Results.Ok(await service.UpdateAsync(id, request, ct)));
        api.MapPost("/{id:guid}/status", async (Guid id, ChangePlayStatusRequest request, PlayService service, CancellationToken ct) =>
            Results.Ok(await service.ChangeStatusAsync(id, request, ct)));
        api.MapGet("/{id:guid}/history", async (Guid id, PlayService service, CancellationToken ct) =>
            Results.Ok(await service.HistoryAsync(id, ct)));
        api.MapGet("/{id:guid}/execution", async (Guid id, PlayExecutionService service, CancellationToken ct) =>
            Results.Ok(await service.GetAsync(id, ct)));
        api.MapPost("/{id:guid}/execution/check", async (Guid id, PlayExecutionService service, CancellationToken ct) =>
            Results.Ok(await service.CheckAsync(id, ct)));
        api.MapPost("/{id:guid}/execution/links", async (Guid id, LinkOrderRequest request, PlayExecutionService service, CancellationToken ct) =>
            Results.Ok(await service.LinkAsync(id, request, ct)));
        api.MapDelete("/{id:guid}/execution/links/{linkId:guid}", async (Guid id, Guid linkId, PlayExecutionService service, CancellationToken ct) =>
            Results.Ok(await service.UnlinkAsync(id, linkId, ct)));
        api.MapDelete("/{id:guid}", async (Guid id, PlayService service, CancellationToken ct) =>
        {
            await service.DeleteAsync(id, ct);
            return Results.NoContent();
        });
    }
}
