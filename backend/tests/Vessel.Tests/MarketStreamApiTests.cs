using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Tests;

public sealed class MarketStreamApiTests
{
    private static string Url(Guid id, string query) => $"/api/accounts/{id}/market-stream?{query}";
    private static readonly VenueCandle SampleCandle = new(1_790_927_520_000, 1_790_927_579_999, "85891.0", "85903.0", "85887.0", "85903.0", "6.19755", 58);
    private static readonly VenueMarketContext SampleContext = new("BTC", "85896.40", "85916", null, "83388.0", "2524355036.618314743", "34715.04450", "0.0000125", null);

    private static (Guid Owner, MemoryWorkspaceStore Store, Account Account) Setup(string venue = "hyperliquid", bool foreign = false, bool disabled = false)
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var account = new Account(Guid.NewGuid(), foreign ? Guid.NewGuid() : owner, venue, "Private account");
        if (disabled) account.UpdateSettings(account.Name, null, false);
        store.Accounts.Add(account);
        return (owner, store, account);
    }

    private static MarketStreamService Service(IWorkspaceStore store, IMarketStream stream, MarketStreamLimiter? limiter = null, TimeProvider? time = null) =>
        new(store, TestVenues.With(stream), limiter ?? new MarketStreamLimiter(), time ?? TimeProvider.System);

    [Theory]
    [InlineData("manual", false, false, "instrument=BTC&interval=1m", 409)]
    [InlineData("hyperliquid", true, false, "instrument=BTC&interval=1m", 404)]
    [InlineData("hyperliquid", false, true, "instrument=BTC&interval=1m", 409)]
    [InlineData("hyperliquid", false, true, "instrument=bad%20coin&interval=nope", 409)]
    [InlineData("hyperliquid", false, false, "interval=1m", 400)]
    [InlineData("hyperliquid", false, false, "instrument=xyz:BTC&interval=1m", 400)]
    [InlineData("hyperliquid", false, false, "instrument=BTC", 400)]
    [InlineData("hyperliquid", false, false, "instrument=BTC&interval=2m", 400)]
    public async Task Invalid_requests_return_problem_details_before_subscribing(string venue, bool foreign, bool disabled, string query, int status)
    {
        var (owner, store, account) = Setup(venue, foreign, disabled); var stream = new FakeMarketStream();
        await using var factory = new CoreApiFactory(owner, store, stream: stream);
        using var client = factory.AuthorizedClient();
        var response = await client.GetAsync(Url(account.Id, query));
        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.DoesNotContain("Private account", await response.Content.ReadAsStringAsync());
        Assert.Empty(stream.Subscriptions);
    }

    [Fact]
    public async Task Requires_authentication()
    {
        var (owner, store, account) = Setup(); var stream = new FakeMarketStream();
        await using var factory = new CoreApiFactory(owner, store, stream: stream);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"))).StatusCode);
        Assert.Empty(stream.Subscriptions);
    }

    [Fact]
    public async Task Venue_mismatch_and_upstream_failures_return_problem_details()
    {
        var (owner, store, account) = Setup();
        // The account's venue has no stream adapter, only another venue's.
        var other = new FakeMarketStream { VenueId = "other" };
        await using (var factory = new CoreApiFactory(owner, store, configure: services =>
        {
            services.RemoveAll<IMarketStream>();
            services.AddSingleton<IMarketStream>(other);
        }))
        {
            using var client = factory.AuthorizedClient();
            var response = await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"));
            Assert.Equal(502, (int)response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Empty(other.Subscriptions);
            Assert.Equal(0, factory.Services.GetRequiredService<MarketStreamLimiter>().Active);
        }
        foreach (var (stream, status) in new[]
        {
            (new FakeMarketStream { Failure = new VenueReadException("secret") }, 502),
            (new FakeMarketStream { Failure = new MarketStreamCapacityException("secret") }, 429)
        })
        {
            await using var factory = new CoreApiFactory(owner, store, stream: stream);
            using var client = factory.AuthorizedClient();
            var response = await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"));
            Assert.Equal(status, (int)response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.DoesNotContain("secret", await response.Content.ReadAsStringAsync());
            Assert.Equal(0, factory.Services.GetRequiredService<MarketStreamLimiter>().Active);
        }
    }

    [Fact]
    public async Task More_than_eight_concurrent_streams_return_429()
    {
        var (owner, store, account) = Setup(); var stream = new FakeMarketStream();
        await using var factory = new CoreApiFactory(owner, store, stream: stream);
        var limiter = factory.Services.GetRequiredService<MarketStreamLimiter>();
        var leases = Enumerable.Range(0, MarketStreamLimiter.MaxStreams).Select(_ => limiter.TryAcquire()!).ToList();
        using var client = factory.AuthorizedClient();
        var response = await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"));
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Contains("Too many live market streams are open.", await response.Content.ReadAsStringAsync());
        Assert.Empty(stream.Subscriptions);
        leases.ForEach(lease => lease.Dispose());
    }

    [Fact]
    public async Task Streams_server_sent_events_with_rest_shapes_and_flushes_each_event()
    {
        var (owner, store, account) = Setup(); var stream = new FakeMarketStream();
        await using var factory = new CoreApiFactory(owner, store, stream: stream);
        using var client = factory.AuthorizedClient();
        using var response = await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"), HttpCompletionOption.ResponseHeadersRead);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("no", Assert.Single(response.Headers.GetValues("X-Accel-Buffering")));
        var subscription = Assert.Single(stream.Subscriptions);
        Assert.Equal(("BTC", "1m"), (subscription.ContractId, subscription.Interval));
        Assert.Equal(1, factory.Services.GetRequiredService<MarketStreamLimiter>().Active);

        await using var body = await response.Content.ReadAsStreamAsync();
        var observed = DateTimeOffset.FromUnixTimeMilliseconds(1_790_927_530_000);
        subscription.Write(new MarketStatusEvent(MarketStreamState.Live, observed));
        // Readable before more data arrives: the server flushes per event.
        var first = await ReadEventAsync(body);
        Assert.Equal($"event: status\ndata: {{\"state\":\"live\",\"observedAt\":{JsonSerializer.Serialize(observed)}}}", first);

        subscription.Write(new MarketCandleEvent(SampleCandle));
        Assert.Equal("event: candle\ndata: {\"openTime\":1790927520000,\"closeTime\":1790927579999,\"open\":\"85891.0\",\"high\":\"85903.0\",\"low\":\"85887.0\",\"close\":\"85903.0\",\"volume\":\"6.19755\",\"trades\":58}",
            await ReadEventAsync(body));

        subscription.Write(new MarketContextEvent(SampleContext with { ContractId = "ETH" }, observed)); // Not this instrument: ignored.
        subscription.Write(new MarketContextEvent(SampleContext, observed));
        var context = await ReadEventAsync(body);
        Assert.StartsWith("event: context\ndata: ", context);
        var data = context.Split('\n')[1]["data: ".Length..];
        using var json = JsonDocument.Parse(data);
        Assert.Equal(new[] { "venueId", "instrument", "markPrice", "oraclePrice", "midPrice", "previousDayPrice", "dayNotionalVolume", "openInterest", "fundingRate", "premium", "observedAt", "notice" },
            json.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal("BTC", json.RootElement.GetProperty("instrument").GetString());
        Assert.Equal("85896.40", json.RootElement.GetProperty("markPrice").GetString());
        Assert.Equal("34715.04450", json.RootElement.GetProperty("openInterest").GetString());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("midPrice").ValueKind);
        Assert.Equal(HyperliquidPerpetualReader.Descriptor.MarketContextNotice, json.RootElement.GetProperty("notice").GetString());

        subscription.Complete();
        Assert.Equal("", await new StreamReader(body).ReadToEndAsync());
        await Eventually.True(() => subscription.Disposed && factory.Services.GetRequiredService<MarketStreamLimiter>().Active == 0,
            "the session releases its subscription and slot");
    }

    [Fact]
    public async Task Client_disconnect_releases_the_subscription_and_slot()
    {
        var (owner, store, account) = Setup(); var stream = new FakeMarketStream();
        await using var factory = new CoreApiFactory(owner, store, stream: stream);
        using var client = factory.AuthorizedClient();
        var response = await client.GetAsync(Url(account.Id, "instrument=BTC&interval=1m"), HttpCompletionOption.ResponseHeadersRead);
        var subscription = Assert.Single(stream.Subscriptions);
        response.Dispose();
        await Eventually.True(() => subscription.Disposed && factory.Services.GetRequiredService<MarketStreamLimiter>().Active == 0,
            "disconnect ends the stream");
    }

    private static async Task<string> ReadEventAsync(Stream body)
    {
        var bytes = new List<byte>();
        var buffer = new byte[1];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!Encoding.UTF8.GetString([.. bytes]).EndsWith("\n\n", StringComparison.Ordinal))
        {
            Assert.Equal(1, await body.ReadAsync(buffer, timeout.Token));
            bytes.Add(buffer[0]);
        }
        return Encoding.UTF8.GetString([.. bytes])[..^2];
    }

    // Service-level behaviour with a deterministic clock.

    [Fact]
    public async Task Service_checks_run_in_contract_order_before_capacity()
    {
        var (_, store, account) = Setup(disabled: true);
        var limiter = new MarketStreamLimiter();
        var leases = Enumerable.Range(0, 8).Select(_ => limiter.TryAcquire()!).ToList();
        var service = Service(store, new FakeMarketStream { VenueId = "other" }, limiter);
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(Guid.NewGuid(), null, null, default))).StatusCode);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, null, null, default))).StatusCode);
        account.UpdateSettings(account.Name, null, true);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, null, null, default))).StatusCode);
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, "BTC", "7m", default))).StatusCode);
        Assert.Equal(502, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, "BTC", "1m", default))).StatusCode);
        service = Service(store, new FakeMarketStream(), limiter);
        Assert.Equal(429, (await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, "BTC", "1m", default))).StatusCode);
        leases.ForEach(lease => lease.Dispose());
    }

    [Fact]
    public async Task Service_allows_eight_streams_and_frees_slots_on_dispose()
    {
        var (_, store, account) = Setup(); var stream = new FakeMarketStream(); var limiter = new MarketStreamLimiter();
        var service = Service(store, stream, limiter);
        var sessions = new List<MarketStreamSession>();
        for (var i = 0; i < 8; i++) sessions.Add(await service.OpenAsync(account.Id, "BTC", "1m", default));
        var busy = await Assert.ThrowsAsync<WorkspaceException>(() => service.OpenAsync(account.Id, "ETH", "1m", default));
        Assert.Equal(429, busy.StatusCode);
        Assert.Equal(8, stream.Subscriptions.Count);
        sessions[0].Dispose();
        sessions[0].Dispose();
        Assert.True(stream.Subscriptions.First().Disposed);
        sessions.Add(await service.OpenAsync(account.Id, "ETH", "1m", default));
        Assert.Equal(8, limiter.Active);
        sessions.ForEach(session => session.Dispose());
        Assert.Equal(0, limiter.Active);
    }

    [Fact]
    public async Task Session_sends_keepalives_when_quiet_and_ends_after_one_hour()
    {
        var (_, store, account) = Setup(); var stream = new FakeMarketStream();
        var time = new ManualTime(DateTimeOffset.FromUnixTimeMilliseconds(1_790_927_520_000));
        using var session = await Service(store, stream, time: time).OpenAsync(account.Id, "BTC", "1m", default);
        await using var messages = session.ReadAllAsync(default).GetAsyncEnumerator();

        var pending = messages.MoveNextAsync().AsTask();
        await Eventually.True(() => time.TimerCount >= 2, "lifetime and keepalive timers armed");
        time.Advance(TimeSpan.FromSeconds(14));
        await Task.Delay(30);
        Assert.False(pending.IsCompleted);
        time.Advance(TimeSpan.FromSeconds(1));
        Assert.True(await pending.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Same(MarketStreamMessage.Keepalive, messages.Current);

        stream.Latest.Write(new MarketStatusEvent(MarketStreamState.Stale, time.GetUtcNow()));
        var status = await Eventually.Next(messages);
        Assert.Equal("status", status.Event);
        Assert.Equal(new MarketStreamStatusDto("stale", time.GetUtcNow()), status.Data);

        pending = messages.MoveNextAsync().AsTask();
        await Eventually.True(() => time.TimerCount >= 2, "keepalive re-armed");
        time.Advance(TimeSpan.FromHours(1));
        // Keepalives may fire on the way; the lifetime ends the stream.
        var ended = false;
        while (!ended)
        {
            if (!await pending.WaitAsync(TimeSpan.FromSeconds(10))) ended = true;
            else
            {
                Assert.Same(MarketStreamMessage.Keepalive, messages.Current);
                pending = messages.MoveNextAsync().AsTask();
            }
        }
    }

    [Fact]
    public async Task Session_ends_quietly_when_the_client_cancels()
    {
        var (_, store, account) = Setup(); var stream = new FakeMarketStream();
        using var session = await Service(store, stream).OpenAsync(account.Id, "BTC", "1m", default);
        using var cancel = new CancellationTokenSource();
        await using var messages = session.ReadAllAsync(cancel.Token).GetAsyncEnumerator();
        var pending = messages.MoveNextAsync().AsTask();
        cancel.Cancel();
        Assert.False(await pending.WaitAsync(TimeSpan.FromSeconds(10)));
    }
}
