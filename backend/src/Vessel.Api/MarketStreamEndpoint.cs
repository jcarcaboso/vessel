using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Vessel.Application.MarketData;

namespace Vessel.Api;

/// <summary>Server-sent events for live public market data. Every check runs before the headers are written.</summary>
public static class MarketStreamEndpoint
{
    private static readonly byte[] KeepaliveComment = Encoding.UTF8.GetBytes(": keepalive\n\n");

    public static async Task StreamAsync(Guid id, string? instrument, string? interval, MarketStreamService service,
        IOptions<JsonOptions> json, HttpContext context)
    {
        var aborted = context.RequestAborted;
        // Failures here propagate to the ProblemDetails middleware as normal responses.
        using var session = await service.OpenAsync(id, instrument, interval, aborted);

        var response = context.Response;
        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = "text/event-stream; charset=utf-8";
        response.Headers.CacheControl = "no-store";
        response.Headers["X-Accel-Buffering"] = "no";
        context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        await response.StartAsync(aborted);
        await response.Body.FlushAsync(aborted);

        var options = json.Value.SerializerOptions;
        try
        {
            await foreach (var message in session.ReadAllAsync(aborted))
            {
                var bytes = message.Event is null
                    ? KeepaliveComment
                    // The serializer escapes control characters, so the JSON stays on one data line.
                    : Encoding.UTF8.GetBytes(
                        $"event: {message.Event}\ndata: {JsonSerializer.Serialize(message.Data, message.Data!.GetType(), options)}\n\n");
                await response.Body.WriteAsync(bytes, aborted);
                await response.Body.FlushAsync(aborted);
            }
        }
        catch (OperationCanceledException) when (aborted.IsCancellationRequested)
        {
            // The client left.
        }
    }
}
