using Vessel.Application.Sizing;

namespace Vessel.Api;

public static class SizingEndpoints
{
    public static void MapSizing(this WebApplication app)
    {
        var api = app.MapGroup("/api/sizing").RequireAuthorization();
        api.MapGet("", async (SizingService service, CancellationToken ct) => Results.Ok(await service.GetAsync(ct)));
        api.MapPut("/settings", async (UpdateSizingSettingsRequest request, SizingService service, CancellationToken ct) =>
            Results.Ok(await service.UpdateSettingsAsync(request, ct)));
    }
}
