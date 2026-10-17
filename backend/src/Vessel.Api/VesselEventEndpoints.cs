using Vessel.Application.Common;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Vessel.Application.Events;
using Vessel.Application.Notifications;
using Vessel.Application.Ownership;
using Vessel.Application.Workspace;
using Vessel.Persistence.Events;
using Vessel.Identity;

namespace Vessel.Api;

public static class VesselEventEndpoints
{
    private static readonly Dictionary<Guid, int> Streams = new();
    private static readonly object StreamLock = new();
    private static int totalStreams;

    public static IEndpointRouteBuilder MapVesselEvents(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/events").RequireAuthorization();
        group.MapGet("", async (string? after, int? limit, IVesselEventReader reader, HttpContext context, CancellationToken ct) =>
        {
            NoStore(context);
            return Results.Ok(await reader.ReadAsync(after, limit ?? 100, ct));
        });
        group.MapGet("/stream", (string? after, string? notificationsAfter, IVesselEventReader reader, IJournalOwnerContext owner,
            IOptions<VesselEventSettings> settings, IOptions<JsonOptions> json, HttpContext context) =>
            StreamAsync(after, reader, owner, settings, json, context, notificationsAfter,
                notificationsAfter is null ? null : context.RequestServices.GetRequiredService<NotificationService>().FeedAsync));
        return endpoints;
    }

    /// <summary>Notification rows drained per poll, so neither feed can starve the other.</summary>
    internal const int NotificationBatch = 50;

    public static Task StreamAsync(string? after, IVesselEventReader reader, IJournalOwnerContext owner,
        IOptions<VesselEventSettings> settings, IOptions<JsonOptions> json, HttpContext context) =>
        StreamAsync(after, reader, owner, settings, json, context, null, null);

    /// <summary>
    /// One owner stream for both feeds. Events keep their frames and SSE <c>id:</c> resume cursors. With
    /// <paramref name="notificationsAfter"/>, a <c>notifications</c> frame (ready or reset, the unread count and the
    /// channel switch) follows the status, and each changed notification is a <c>notification</c> frame whose cursor
    /// travels in its data, never in the <c>id:</c> line. The two cursors and their resets are independent.
    /// </summary>
    public static async Task StreamAsync(string? after, IVesselEventReader reader, IJournalOwnerContext owner,
        IOptions<VesselEventSettings> settings, IOptions<JsonOptions> json, HttpContext context, string? notificationsAfter,
        Func<string?, int, CancellationToken, Task<NotificationFeed>>? notifications)
    {
        NoStore(context);
        if (!VesselEventCursor.TryParse(after, out _))
            throw new ProblemException(400, "Invalid event cursor.");
        if (notificationsAfter is not null && (notifications is null || !NotificationCursor.TryParse(notificationsAfter, out _)))
            throw new ProblemException(400, "Invalid notification cursor.");
        if (!TryAcquire(owner.OwnerId, context.RequestServices?.GetService<IdentitySettings>()?.MaxEventStreams ?? 64))
        {
            throw new ProblemException(429, "The event stream limit has been reached.", "rate-limited", 5);
        }
        var ownerId = owner.OwnerId;
        try
        {
            await using var validation = new PrincipalRevalidation(
                context.RequestServices?.GetService<IPrincipalValidity>() ?? new AlwaysValidPrincipal(),
                context.RequestAborted, context.RequestServices?.GetService<TimeProvider>() ?? TimeProvider.System);
            var ct = validation.Token;
            try
            {
                // Validate/query both feeds before committing SSE headers so normal errors remain ProblemDetails.
                var page = await reader.ReadAsync(after, 200, ct);
                var feed = notifications is null ? null : await notifications(notificationsAfter, NotificationBatch, ct);
                var notificationCursor = notificationsAfter;
                context.Response.ContentType = "text/event-stream; charset=utf-8";
                context.Response.Headers["X-Accel-Buffering"] = "no";
                context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
                await context.Response.StartAsync(ct);
                async Task Frame(string type, object data, string? id = null)
                {
                    var resume = id is null ? "" : $"id: {id}\n";
                    await context.Response.WriteAsync($"event: {type}\n{resume}data: {JsonSerializer.Serialize(data, json.Value.SerializerOptions)}\n\n", ct);
                    await context.Response.Body.FlushAsync(ct);
                }
                // Ready must not acknowledge a page that has not been written to this stream yet. It carries the
                // accepted cursor normalized with the stream epoch; reset carries where a reloaded client resumes.
                var cursor = page.ResetRequired ? page.NextCursor : Accepted(after, page.NextCursor);
                await Frame("status", new { state = page.ResetRequired ? "reset" : "ready", nextCursor = cursor });
                // Bounded lifetime: expiry is checked before every event frame, so the response ends cleanly between frames
                // (never mid-frame), even part-way through a page. Every written event frame carries its own resume cursor,
                // so the browser reconnects from the last fully written frame and the unsent rest of the page is replayed.
                var time = context.RequestServices?.GetService<TimeProvider>() ?? TimeProvider.System;
                var started = time.GetTimestamp();
                var lifetime = settings.Value.StreamMaxLifetime;
                TimeSpan Remaining() => lifetime - time.GetElapsedTime(started);
                if (feed is not null)
                    await Frame("notifications", new
                    {
                        state = feed.ResetRequired ? "reset" : "ready",
                        nextCursor = feed.ResetRequired ? feed.NextCursor : notificationsAfter,
                        unreadCount = feed.UnreadCount, enabled = feed.Enabled
                    });
                while (!ct.IsCancellationRequested)
                {
                    // A reset means reload state, not replay popups from retained history.
                    if (!page.ResetRequired)
                        foreach (var message in page.Events)
                        {
                            if (Remaining() <= TimeSpan.Zero) return;
                            await Frame("event", message, Resume(page.NextCursor, message.Sequence));
                        }
                    cursor = page.NextCursor;
                    var notificationsBehind = false;
                    if (feed is not null)
                    {
                        if (!feed.ResetRequired)
                            foreach (var item in feed.Items)
                            {
                                // The same bounded lifetime: the browser resumes from the last notification frame it received.
                                if (Remaining() <= TimeSpan.Zero) return;
                                await Frame("notification", new { cursor = item.Cursor, unreadCount = feed.UnreadCount, enabled = feed.Enabled,
                                    notification = item.Notification });
                            }
                        notificationCursor = feed.NextCursor;
                        notificationsBehind = feed.Items.Count == NotificationBatch;
                    }
                    if (page.Events.Count < 200 && !notificationsBehind)
                    {
                        await context.Response.WriteAsync(": keepalive\n\n", ct);
                        await context.Response.Body.FlushAsync(ct);
                        var poll = TimeSpan.FromSeconds(settings.Value.StreamPollSeconds);
                        var remaining = Remaining();
                        if (remaining <= TimeSpan.Zero) break;
                        await Task.Delay(remaining < poll ? remaining : poll, time, ct);
                    }
                    if (Remaining() <= TimeSpan.Zero) break;
                    page = await reader.ReadAsync(cursor, 200, ct);
                    if (page.ResetRequired)
                        await Frame("status", new { state = "reset", nextCursor = page.NextCursor });
                    if (notifications is not null)
                    {
                        feed = await notifications(notificationCursor, NotificationBatch, ct);
                        if (feed.ResetRequired)
                            await Frame("notifications", new { state = "reset", nextCursor = feed.NextCursor,
                                unreadCount = feed.UnreadCount, enabled = feed.Enabled });
                    }
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        }
        finally { Release(ownerId); }
    }

    // The page cursor already names the epoch; an accepted request cursor keeps its own sequence.
    // Both parses always succeed: StreamAsync rejected an invalid request cursor with 400 before reading, and
    // the page cursor is produced by the server's own VesselEventCursor.Format. The results are discarded deliberately.
    private static string Accepted(string? after, string next)
    {
        _ = VesselEventCursor.TryParse(after, out var requested);
        _ = VesselEventCursor.TryParse(next, out var page);
        return VesselEventCursor.Format(page.Epoch, requested.Sequence);
    }

    // The page cursor is server-produced (VesselEventCursor.Format), so the parse always succeeds.
    private static string Resume(string pageCursor, string sequence)
    {
        _ = VesselEventCursor.TryParse(pageCursor, out var page);
        return VesselEventCursor.Format(page.Epoch, long.Parse(sequence, System.Globalization.CultureInfo.InvariantCulture));
    }

    internal static bool TryAcquire(Guid owner, int maximum = 64)
    {
        lock (StreamLock)
        {
            var count = Streams.GetValueOrDefault(owner);
            if (count >= 4 || totalStreams >= maximum) return false;
            Streams[owner] = count + 1;
            totalStreams++;
            return true;
        }
    }
    private static void NoStore(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.OnStarting(() =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Task.CompletedTask;
        });
    }
    internal static void Release(Guid owner)
    {
        lock (StreamLock)
        {
            if (!Streams.TryGetValue(owner, out var count) || count < 1) return;
            if (count == 1) Streams.Remove(owner);
            else Streams[owner] = count - 1;
            totalStreams--;
        }
    }
}
