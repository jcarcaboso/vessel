using Vessel.Application.Common;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;
using Vessel.Api;
using Vessel.Application.Events;
using Vessel.Application.Workspace;
using Vessel.Persistence.Events;

namespace Vessel.Tests;

public sealed class PlayEventStreamTests
{
    [Fact]
    public async Task Stream_bounds_four_sessions_per_owner_and_releases_all_on_disconnect()
    {
        var owner = new CoreOwner(Guid.NewGuid());
        using var cancellation = new CancellationTokenSource();
        var reader = new FixedReader();
        var tasks = Enumerable.Range(0, 4).Select(_ => Open(owner, reader, cancellation.Token)).ToList();
        var rejected = await Assert.ThrowsAsync<ProblemException>(() => Open(owner, reader, cancellation.Token));
        Assert.Equal(429, rejected.StatusCode);
        using var otherCancellation = new CancellationTokenSource();
        var other = Open(new(Guid.NewGuid()), reader, otherCancellation.Token);
        Assert.False(other.IsCompleted);
        await otherCancellation.CancelAsync();
        await other;
        await cancellation.CancelAsync();
        await Task.WhenAll(tasks);
        using var again = new CancellationTokenSource();
        var fresh = Open(owner, reader, again.Token);
        Assert.False(fresh.IsCompleted);
        await again.CancelAsync();
        await fresh;
    }

    [Fact]
    public async Task Reset_frame_skips_historical_events_and_keeps_a_string_cursor()
    {
        var owner = new CoreOwner(Guid.NewGuid());
        using var cancellation = new CancellationTokenSource();
        using var body = new MemoryStream();
        var context = Context(body, cancellation.Token);
        var read = new FixedReader(new([], "9007199254740993", true));
        var stream = PlayEventEndpoints.StreamAsync("999", read, owner,
            Options.Create(new PlayEventSettings()), Options.Create(new JsonOptions()), context);
        Assert.False(stream.IsCompleted);
        var text = Encoding.UTF8.GetString(body.ToArray());
        Assert.Contains("event: status\ndata: {\"state\":\"reset\",\"nextSequence\":\"9007199254740993\"}", text);
        Assert.DoesNotContain("event: event", text);
        Assert.Equal("no-store", context.Response.Headers.CacheControl);
        Assert.Equal("text/event-stream; charset=utf-8", context.Response.ContentType);
        await cancellation.CancelAsync();
        await stream;
    }

    [Fact]
    public async Task Failed_initial_read_releases_session_before_headers_or_retry()
    {
        var owner = new CoreOwner(Guid.NewGuid());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Open(owner, new FailingReader(), default));
        using var cancellation = new CancellationTokenSource();
        var streams = Enumerable.Range(0, 4).Select(_ => Open(owner, new FixedReader(), cancellation.Token)).ToArray();
        await cancellation.CancelAsync();
        await Task.WhenAll(streams);
    }

    [Fact]
    public async Task Ready_does_not_acknowledge_unwritten_catchup_and_events_are_sent_in_cursor_order()
    {
        var owner = new CoreOwner(Guid.NewGuid());
        using var cancellation = new CancellationTokenSource();
        using var body = new MemoryStream();
        var at = DateTimeOffset.UtcNow;
        var message = new PlayEvent(Guid.CreateVersion7(), "monitor.state-changed", 1, owner.OwnerId, "1",
            Guid.CreateVersion7(), "first", "info", at, at, "timely", "current", null, new(), new("monitor"),
            JsonSerializer.SerializeToElement(new { current = "live" }));
        var context = Context(body, cancellation.Token);
        var stream = PlayEventEndpoints.StreamAsync("0", new FixedReader(new([message], "1", false)), owner,
            Options.Create(new PlayEventSettings()), Options.Create(new JsonOptions()), context);
        var text = Encoding.UTF8.GetString(body.ToArray());
        Assert.StartsWith("event: status\ndata: {\"state\":\"ready\",\"nextSequence\":\"0\"}", text);
        Assert.Contains("event: event\ndata: {\"id\":", text);
        Assert.Contains("\"sequence\":\"1\"", text);
        await cancellation.CancelAsync();
        await stream;
    }

    private static Task Open(CoreOwner owner, IPlayEventReader reader, CancellationToken ct) =>
        PlayEventEndpoints.StreamAsync("0", reader, owner, Options.Create(new PlayEventSettings()),
            Options.Create(new JsonOptions()), Context(new MemoryStream(), ct));
    private static DefaultHttpContext Context(Stream body, CancellationToken ct)
    {
        var context = new DefaultHttpContext { RequestAborted = ct };
        context.Response.Body = body;
        return context;
    }
    private sealed class FixedReader(PlayEventPage? initial = null) : IPlayEventReader
    {
        public Task<PlayEventPage> ReadAsync(long after, int limit, CancellationToken ct) =>
            Task.FromResult(initial ?? new([], after.ToString(System.Globalization.CultureInfo.InvariantCulture), false));
    }
    private sealed class FailingReader : IPlayEventReader
    {
        public Task<PlayEventPage> ReadAsync(long after, int limit, CancellationToken ct) =>
            throw new InvalidOperationException("Synthetic database outage.");
    }
}
