using Vessel.Application.Common;
using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Application.Workspace;
using Vessel.Persistence.Events;

namespace Vessel.Api;

public static class VesselEventEndpoints
{
    private static readonly ConcurrentDictionary<Guid, int> Streams = new();

    public static IEndpointRouteBuilder MapVesselEvents(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/events").RequireAuthorization();
        group.MapGet("", async (string? after, int? limit, IVesselEventReader reader, HttpContext context, CancellationToken ct) =>
        {
            NoStore(context);
            return Results.Ok(await reader.ReadAsync(after, limit ?? 100, ct));
        });
        group.MapGet("/stream", StreamAsync);
        return endpoints;
    }

    public static async Task StreamAsync(string? after, IVesselEventReader reader, IJournalOwnerContext owner,
        IOptions<VesselEventSettings> settings, IOptions<JsonOptions> json, HttpContext context)
    {
        NoStore(context);
        if (!VesselEventCursor.TryParse(after, out _))
            throw new ProblemException(400, "Invalid event cursor.");
        if (!TryAcquire(owner.OwnerId))
        {
            context.Response.Headers.RetryAfter = "5";
            throw new ProblemException(429, "At most four event streams may be open per owner.");
        }
        var ownerId = owner.OwnerId;
        var ct = context.RequestAborted;
        try
        {
            // Validate/query before committing SSE headers so normal errors remain ProblemDetails.
            var page = await reader.ReadAsync(after, 200, ct);
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
            while (!ct.IsCancellationRequested)
            {
                // A reset means reload state, not replay popups from retained history.
                if (!page.ResetRequired)
                    foreach (var message in page.Events)
                        await Frame("event", message, Resume(page.NextCursor, message.Sequence));
                cursor = page.NextCursor;
                if (page.Events.Count < 200)
                {
                    await context.Response.WriteAsync(": keepalive\n\n", ct);
                    await context.Response.Body.FlushAsync(ct);
                    await Task.Delay(TimeSpan.FromSeconds(settings.Value.StreamPollSeconds), ct);
                }
                page = await reader.ReadAsync(cursor, 200, ct);
                if (page.ResetRequired)
                    await Frame("status", new { state = "reset", nextCursor = page.NextCursor });
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        finally { Release(ownerId); }
    }

    // The page cursor already names the epoch; an accepted request cursor keeps its own sequence.
    private static string Accepted(string? after, string next)
    {
        VesselEventCursor.TryParse(after, out var requested);
        VesselEventCursor.TryParse(next, out var page);
        return VesselEventCursor.Format(page.Epoch, requested.Sequence);
    }

    private static string Resume(string pageCursor, string sequence)
    {
        VesselEventCursor.TryParse(pageCursor, out var page);
        return VesselEventCursor.Format(page.Epoch, long.Parse(sequence, System.Globalization.CultureInfo.InvariantCulture));
    }

    internal static bool TryAcquire(Guid owner)
    {
        while (true)
        {
            var count = Streams.GetOrAdd(owner, 0);
            if (count >= 4) return false;
            if (Streams.TryUpdate(owner, count + 1, count)) return true;
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
        while (true)
        {
            if (!Streams.TryGetValue(owner, out var count) || count < 1) return;
            if (count == 1)
            {
                if (((ICollection<KeyValuePair<Guid, int>>)Streams).Remove(new(owner, count))) return;
            }
            else if (Streams.TryUpdate(owner, count - 1, count)) return;
        }
    }
}
