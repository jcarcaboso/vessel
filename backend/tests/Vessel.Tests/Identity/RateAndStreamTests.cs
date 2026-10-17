using System.Diagnostics;
using System.Security.Claims;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using Nethereum.Signer;
using Vessel.Api;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Application.MarketData;
using Vessel.Domain.Accounts;
using Vessel.Identity;
using Vessel.Persistence.Events;

namespace Vessel.Tests.Identity;

public sealed class RateLimitTests
{
    [Fact]
    public void Client_partitions_group_IPv6_by_64_and_normalize_mapped_IPv4()
    {
        Assert.Equal(IdentityRateLimits.Client(IPAddress.Parse("2001:db8:1234:abcd::1")),
            IdentityRateLimits.Client(IPAddress.Parse("2001:db8:1234:abcd::ffff")));
        Assert.NotEqual(IdentityRateLimits.Client(IPAddress.Parse("2001:db8:1234:abcd::1")),
            IdentityRateLimits.Client(IPAddress.Parse("2001:db8:1234:abce::1")));
        Assert.Equal(IdentityRateLimits.Client(IPAddress.Parse("192.0.2.1")), IdentityRateLimits.Client(IPAddress.Parse("::ffff:192.0.2.1")));
    }

    [Fact]
    public void Client_and_global_limits_are_both_enforced_without_wallet_address_partitions()
    {
        using var limits = new IdentityRateLimits();
        static DefaultHttpContext Context(string path, string address)
        {
            var context = new DefaultHttpContext();
            context.Request.Path = path; context.Request.Method = "POST"; context.Connection.RemoteIpAddress = IPAddress.Parse(address);
            return context;
        }
        var one = Context("/api/auth/challenge", "192.0.2.1");
        for (var i = 0; i < 10; i++) using (var lease = limits.Requests.AttemptAcquire(one)) Assert.True(lease.IsAcquired);
        using (var lease = limits.Requests.AttemptAcquire(one)) Assert.False(lease.IsAcquired);
        var other = Context("/api/auth/challenge", "192.0.2.2");
        using (var lease = limits.Requests.AttemptAcquire(other)) Assert.True(lease.IsAcquired);
        for (var i = 0; i < 289; i++)
        {
            using var lease = limits.Requests.AttemptAcquire(Context("/api/auth/challenge", $"10.{i / 256}.{i % 256}.1"));
            Assert.True(lease.IsAcquired);
        }
        using (var lease = limits.Requests.AttemptAcquire(Context("/api/auth/challenge", "192.0.2.3"))) Assert.False(lease.IsAcquired);
        var verify = Context("/api/auth/verify", "192.0.2.1");
        for (var i = 0; i < 20; i++) using (var lease = limits.Requests.AttemptAcquire(verify)) Assert.True(lease.IsAcquired);
        verify.Request.Path = "/api/auth/register";
        using (var lease = limits.Requests.AttemptAcquire(verify)) Assert.False(lease.IsAcquired);
        for (var i = 0; i < 10; i++) limits.CheckInvitation(verify);
        var error = Assert.Throws<Vessel.Application.Common.ProblemException>(() => limits.CheckInvitation(verify));
        Assert.Equal("rate-limited", error.Code);
        Assert.True(error.RetryAfterSeconds > 0);
    }

    [Fact]
    public async Task Missing_cookie_never_resolves_the_database_and_principal_checks_fail_closed()
    {
        var sessions = new SessionStore(() => throw new InvalidOperationException("Synthetic unavailable database"), new(), TimeProvider.System);
        var error = await Assert.ThrowsAsync<Vessel.Application.Common.ProblemException>(() => sessions.AuthenticateAsync(null, true, default));
        Assert.Equal("session-required", error.Code);
        Assert.False(await sessions.StillValidAsync(Guid.NewGuid(), default));
    }

    [Fact]
    public void Step_up_and_link_limits_have_independent_session_buckets_not_IP_buckets()
    {
        using var limits = new IdentityRateLimits();
        var context = new DefaultHttpContext();
        context.Request.Method = "POST";
        context.Request.Path = "/api/auth/step-up/challenge";
        context.User = new(new ClaimsIdentity([new Claim(SessionAuthentication.SessionClaim, Guid.NewGuid().ToString())], SessionAuthentication.SchemeName));
        for (var i = 0; i < 10; i++) using (var lease = limits.Requests.AttemptAcquire(context)) Assert.True(lease.IsAcquired);
        context.Request.Path = "/api/auth/step-up";
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.3");
        using (var lease = limits.Requests.AttemptAcquire(context))
        {
            Assert.False(lease.IsAcquired);
            Assert.InRange(IdentityRateLimits.RetryAfter(lease), 1, 600);
        }
        context.Request.Path = "/api/auth/wallets";
        for (var i = 0; i < 10; i++) using (var lease = limits.Requests.AttemptAcquire(context)) Assert.True(lease.IsAcquired);
        context.Request.Path = "/api/auth/wallets/challenge";
        using (var lease = limits.Requests.AttemptAcquire(context))
        {
            Assert.False(lease.IsAcquired);
            Assert.InRange(IdentityRateLimits.RetryAfter(lease), 1, 600);
        }
        context.User = new(new ClaimsIdentity([new Claim(SessionAuthentication.SessionClaim, Guid.NewGuid().ToString())], SessionAuthentication.SchemeName));
        using (var lease = limits.Requests.AttemptAcquire(context)) Assert.True(lease.IsAcquired);
        context.Request.Path = "/api/auth/step-up/challenge";
        using (var lease = limits.Requests.AttemptAcquire(context)) Assert.True(lease.IsAcquired);
    }
}

[CollectionDefinition("Identity streams", DisableParallelization = true)]
public sealed class IdentityStreamCollection;

[Collection("Identity streams")]
public sealed class StreamRevalidationTests
{
    [Theory]
    [InlineData("Token")]
    [InlineData("Wallet")]
    public async Task Each_authentication_mode_registers_its_principal_validity(string mode)
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid(), settings: new()
        {
            ["Vessel:Auth:Mode"] = mode, ["Vessel:Auth:Token"] = mode == "Token" ? CoreApiFactory.Token : null,
            ["Vessel:Identity:Origins:0"] = "https://vessel.test"
        });
        using var scope = factory.Services.CreateScope();
        var validity = scope.ServiceProvider.GetRequiredService<IPrincipalValidity>();
        if (mode == "Token")
        {
            Assert.IsType<AlwaysValidPrincipal>(validity);
            Assert.True(await validity.StillValidAsync(default));
        }
        else
        {
            Assert.IsType<SessionPrincipal>(validity);
            Assert.False(await validity.StillValidAsync(default));
        }
    }

    [Theory]
    [InlineData(1)]
    [InlineData(64)]
    public async Task Both_event_caps_preserve_RetryAfter_and_code_at_the_client(int maximum)
    {
        var owner = Guid.NewGuid();
        await using var factory = new CoreApiFactory(owner, settings: new() { ["Vessel:Events:MaxStreams"] = maximum.ToString() },
            configure: services => services.AddScoped<IVesselEventReader>(_ => new EmptyReader()));
        using var client = factory.AuthorizedClient();
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var streams = new List<HttpResponseMessage>();
        try
        {
            for (var i = 0; i < (maximum == 1 ? 1 : 4); i++)
            {
                var stream = await client.GetAsync("/api/events/stream?after=0", HttpCompletionOption.ResponseHeadersRead, stop.Token);
                Assert.Equal(HttpStatusCode.OK, stream.StatusCode);
                streams.Add(stream);
            }
            HttpResponseMessage rejected;
            if (maximum == 1)
            {
                await using var second = new CoreApiFactory(Guid.NewGuid(), settings: new() { ["Vessel:Events:MaxStreams"] = "1" },
                    configure: services => services.AddScoped<IVesselEventReader>(_ => new EmptyReader()));
                using var other = second.AuthorizedClient();
                rejected = await other.GetAsync("/api/events/stream?after=0", stop.Token);
            }
            else rejected = await client.GetAsync("/api/events/stream?after=0", stop.Token);
            using (rejected)
            {
                await IdentityHttpTest.Code(rejected, 429, "rate-limited");
                Assert.Equal(TimeSpan.FromSeconds(5), rejected.Headers.RetryAfter?.Delta);
            }
        }
        finally
        {
            await stop.CancelAsync();
            foreach (var stream in streams) stream.Dispose();
        }
    }

    [Fact]
    public async Task An_otherwise_idle_event_stream_stops_on_the_15_second_revalidation_timer()
    {
        var validity = new InvalidPrincipal();
        await using var provider = new ServiceCollection().AddSingleton<IPrincipalValidity>(validity)
            .AddSingleton(TimeProvider.System).BuildServiceProvider();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider, RequestAborted = timeout.Token };
        context.Response.Body = body;
        var elapsed = Stopwatch.StartNew();
        await VesselEventEndpoints.StreamAsync("0", new EmptyReader(), new CoreOwner(Guid.NewGuid()),
            Options.Create(new VesselEventSettings { StreamPollSeconds = 60 }), Options.Create(new JsonOptions()), context);
        Assert.Equal(1, validity.Calls);
        Assert.InRange(elapsed.Elapsed.TotalSeconds, 14, 17);
        Assert.False(timeout.IsCancellationRequested);
    }

    [Fact]
    public async Task Revalidation_exceptions_end_the_response_instead_of_leaking_or_leaving_it_running()
    {
        var clock = new ManualTime(DateTimeOffset.UtcNow);
        await using var validation = new PrincipalRevalidation(new ThrowingPrincipal(), clock, default);
        clock.Advance(TimeSpan.FromSeconds(15));
        await Eventually.True(() => validation.Token.IsCancellationRequested, "A failing revalidation must terminate the stream.");
        Assert.True(validation.Token.IsCancellationRequested);
    }

    [Fact]
    public async Task Market_stream_revalidates_without_waiting_for_traffic_and_releases_its_subscription()
    {
        var owner = Guid.NewGuid();
        var store = new MemoryWorkspaceStore(owner);
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Synthetic");
        store.Accounts.Add(account);
        var source = new FakeMarketStream();
        var limiter = new MarketStreamLimiter();
        var service = new MarketStreamService(store, TestVenues.With(source), limiter, TimeProvider.System);
        var clock = new ManualTime(DateTimeOffset.UtcNow);
        var validity = new InvalidPrincipal();
        await using var provider = new ServiceCollection().AddSingleton<IPrincipalValidity>(validity)
            .AddSingleton<TimeProvider>(clock).BuildServiceProvider();
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider };
        context.Response.Body = body;
        var stream = MarketStreamEndpoint.StreamAsync(account.Id, "BTC", "1m", service, Options.Create(new JsonOptions()), context);
        await Eventually.True(() => source.Subscriptions.Count > 0, "The market subscription must start.");
        Assert.False(stream.IsCompleted);
        clock.Advance(TimeSpan.FromSeconds(15));
        await stream.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, validity.Calls);
        Assert.True(source.Latest.Disposed);
        Assert.Equal(0, limiter.Active);
    }

    [PostgresFact]
    public async Task A_captured_wallet_principal_closes_an_open_event_stream_after_revocation()
    {
        await using var database = await IdentityDatabase.CreateAsync();
        var key = EthECKey.GenerateKey();
        await database.SeedAsync(key);
        var issued = await database.SignInAsync(key);
        var principal = new SessionPrincipal(database.Sessions())
        {
            Authenticated = await database.Sessions().AuthenticateAsync(issued.Token, false, default)
        };
        var clock = new ManualTime(database.Clock.Now);
        await using var provider = new ServiceCollection().AddSingleton<IPrincipalValidity>(principal)
            .AddSingleton<TimeProvider>(clock).BuildServiceProvider();
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider };
        context.Response.Body = body;
        var stream = VesselEventEndpoints.StreamAsync("0", new EmptyReader(), new CoreOwner(issued.Session.User.Id),
            Options.Create(new VesselEventSettings { StreamPollSeconds = 60 }), Options.Create(new JsonOptions()), context);
        Assert.False(stream.IsCompleted);
        await using (var db = database.CreateDbContext())
            await db.Sessions.ExecuteUpdateAsync(update => update.SetProperty(x => x.RevokedAt, database.Clock.Now));
        clock.Advance(TimeSpan.FromSeconds(15));
        await stream.WaitAsync(TimeSpan.FromSeconds(5));
    }

    private sealed class EmptyReader : IVesselEventReader
    {
        private readonly string cursor = Guid.NewGuid().ToString("N") + ".0";
        public Task<VesselEventPage> ReadAsync(string? after, int limit, CancellationToken ct) => Task.FromResult(new VesselEventPage([], cursor, false));
    }
    private sealed class InvalidPrincipal : IPrincipalValidity
    {
        public int Calls { get; private set; }
        public ValueTask<bool> StillValidAsync(CancellationToken cancellationToken) { Calls++; return ValueTask.FromResult(false); }
    }
    private sealed class ThrowingPrincipal : IPrincipalValidity
    {
        public ValueTask<bool> StillValidAsync(CancellationToken cancellationToken) => throw new InvalidOperationException("Synthetic outage");
    }
}
