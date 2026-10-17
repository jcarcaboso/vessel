using System.Globalization;
using Vessel.Application.Notifications;

namespace Vessel.Api;

/// <summary>
/// In-app notifications: the head, the Notifications page, popup claims, reads, preferences and the test request.
/// Every route is owner-scoped and <c>no-store</c>; the browser receives changes through the event stream.
/// </summary>
public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotifications(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/notifications").RequireAuthorization()
            .AddEndpointFilter(async (context, next) =>
            {
                context.HttpContext.Response.Headers.CacheControl = "no-store";
                return await next(context);
            });
        group.MapGet("/head", async (NotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.HeadAsync(ct)));
        group.MapGet("", async (string? tab, string? category, string? severity, string? page, string? pageSize,
            NotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.PageAsync(new(tab ?? "unread", Blank(category), Blank(severity),
                Number(page, 1), Number(pageSize, 25)), ct)));
        group.MapPost("/claim", async (NotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.ClaimAsync(ct)));
        group.MapPost("/{id:guid}/read", async (Guid id, NotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.ReadAsync(id, ct)));
        group.MapPost("/read", async (ReadAllNotificationsRequest request, NotificationService notifications, CancellationToken ct) =>
            Results.Ok(new { read = await notifications.ReadAllAsync(request.UpTo, ct) }));
        group.MapGet("/preferences", async (NotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.PreferencesAsync(ct)));
        group.MapPut("/preferences", async (UpdateNotificationPreferencesRequest request, NotificationService notifications,
            CancellationToken ct) => Results.Ok(await notifications.SavePreferencesAsync(request, ct)));
        group.MapPost("/test", async (HttpContext context, NotificationService notifications, CancellationToken ct) =>
        {
            try
            {
                await notifications.RequestTestAsync(ct);
                return Results.Accepted();
            }
            catch (NotificationTestCooldownException wait)
            {
                context.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(wait.RetryAfter.TotalSeconds))
                    .ToString(CultureInfo.InvariantCulture);
                return Results.Problem(statusCode: 429, title: "A test notification was requested moments ago.");
            }
        });
        return endpoints;
    }

    private static string? Blank(string? value) => string.IsNullOrEmpty(value) ? null : value;

    // Malformed numbers become values the service rejects with 400 rather than a binding failure.
    private static int Number(string? value, int fallback) => value is null ? fallback
        : int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : -1;
}

public sealed record ReadAllNotificationsRequest(string? UpTo);
