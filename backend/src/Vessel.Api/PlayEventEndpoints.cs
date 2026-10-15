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

public static class PlayEventEndpoints
{
    private static readonly ConcurrentDictionary<Guid, int> Streams = new();

    public static IEndpointRouteBuilder MapPlayEvents(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/events").RequireAuthorization();
        group.MapGet("", async (string? after, int? limit, IPlayEventReader reader, HttpContext context, CancellationToken ct) =>
        {
            NoStore(context);
            if (!PlayEventValues.TrySequence(after, out var sequence))
                throw new ProblemException(400, "Invalid event sequence.");
            return Results.Ok(await reader.ReadAsync(sequence, limit ?? 100, ct));
        });
        group.MapGet("/stream", StreamAsync);
        return endpoints;
    }

    public static async Task StreamAsync(string? after, IPlayEventReader reader, IJournalOwnerContext owner,
        IOptions<PlayEventSettings> settings, IOptions<JsonOptions> json, HttpContext context)
    {
        NoStore(context);
        if (!PlayEventValues.TrySequence(after, out var sequence))
            throw new ProblemException(400, "Invalid event sequence.");
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
            var page = await reader.ReadAsync(sequence, 200, ct);
            context.Response.ContentType = "text/event-stream; charset=utf-8";
            context.Response.Headers["X-Accel-Buffering"] = "no";
            context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            await context.Response.StartAsync(ct);
            async Task Frame(string type, object data)
            {
                await context.Response.WriteAsync($"event: {type}\ndata: {JsonSerializer.Serialize(data, json.Value.SerializerOptions)}\n\n", ct);
                await context.Response.Body.FlushAsync(ct);
            }
            // Ready must not acknowledge a page that has not been written to this stream yet.
            await Frame("status", new
            {
                state = page.ResetRequired ? "reset" : "ready",
                nextSequence = page.ResetRequired ? page.NextSequence :
                    sequence.ToString(System.Globalization.CultureInfo.InvariantCulture)
            });
            while (!ct.IsCancellationRequested)
            {
                if (page.ResetRequired)
                {
                    // A reset means reload state, not replay popups from retained history.
                    sequence = long.Parse(page.NextSequence, System.Globalization.CultureInfo.InvariantCulture);
                }
                else foreach (var message in page.Events) await Frame("event", message);
                sequence = long.Parse(page.NextSequence, System.Globalization.CultureInfo.InvariantCulture);
                if (page.Events.Count < 200)
                {
                    await context.Response.WriteAsync(": keepalive\n\n", ct);
                    await context.Response.Body.FlushAsync(ct);
                    await Task.Delay(TimeSpan.FromSeconds(settings.Value.CatchupSeconds), ct);
                }
                page = await reader.ReadAsync(sequence, 200, ct);
                if (page.ResetRequired)
                    await Frame("status", new { state = "reset", nextSequence = page.NextSequence });
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        finally { Release(ownerId); }
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
