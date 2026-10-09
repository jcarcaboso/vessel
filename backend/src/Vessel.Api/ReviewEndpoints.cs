using Vessel.Application.Review;

namespace Vessel.Api;

public static class ReviewEndpoints
{
    public static void MapReview(this WebApplication app)
    {
        app.MapGet("/api/review", async (string? period, string? portfolio, Guid? accountId, string? instrument, int? offset,
            ReviewService service, HttpContext context, CancellationToken ct) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(await service.GetAsync(new(period ?? "month", portfolio ?? "all", accountId, instrument, offset ?? 0), ct));
        }).RequireAuthorization();
    }
}
