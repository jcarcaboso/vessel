using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;

namespace Vessel.Api;

public static class PlayEndpoints
{
    private const long ManualExecutionBodyBytes = 16_384;
    private const long RetrospectiveBodyBytes = 131_072;
    private const string DiaryTooLarge = "Diary request is too large.";

    public static void MapPlays(this WebApplication app)
    {
        var api = app.MapGroup("/api/plays").RequireAuthorization();
        api.MapGet("", async (PlayService service, CancellationToken ct) => Results.Ok(await service.ListAsync(ct)));
        api.MapPost("", async (CreatePlayRequest request, PlayService service, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(request, ct);
            return Results.Created($"/api/plays/{result.Summary.Id}", result);
        });
        api.MapPost("/retrospective", async (CreateRetrospectiveRequest request, DiaryService service, CancellationToken ct) =>
            Results.Ok(await service.CreateRetrospectiveAsync(request, ct)))
            .WithBodyLimit(RetrospectiveBodyBytes, DiaryTooLarge);
        api.MapGet("/{id:guid}/manual-executions", async (Guid id, DiaryService service, CancellationToken ct) =>
            Results.Ok(await service.ManualAsync(id, ct)));
        api.MapPost("/{id:guid}/manual-executions", async (Guid id, ManualExecutionRequest request, DiaryService service, CancellationToken ct) =>
            Results.Ok(await service.RecordAsync(id, null, request, ct)))
            .WithBodyLimit(ManualExecutionBodyBytes, DiaryTooLarge);
        api.MapPut("/{id:guid}/manual-executions/{executionId:guid}", async (Guid id, Guid executionId, ManualExecutionRequest request,
            DiaryService service, CancellationToken ct) => Results.Ok(await service.RecordAsync(id, executionId, request, ct)))
            .WithBodyLimit(ManualExecutionBodyBytes, DiaryTooLarge);
        // Previewing a retrospective Play starts from an Activity operation, so it lives under /api/activity.
        var activity = app.MapGroup("/api/activity").RequireAuthorization();
        activity.MapGet("/retrospective", async (Guid accountId, string operationId, DiaryService service, CancellationToken ct) =>
            Results.Ok(await service.PreviewAsync(accountId, operationId, ct)));
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
