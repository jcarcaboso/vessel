using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Vessel.Application.Credentials;
using Vessel.Application.MarketData;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Infrastructure.Auth;
using Vessel.Infrastructure.Credentials;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Tests.Isolation;

/// <summary>
/// Test-only authentication: the <see cref="Header"/> names the owner of each request and the handler issues the
/// production owner claims (<see cref="JournalOwnerClaims"/>). Registered as the default scheme, so the bearer token
/// path never runs in this suite. Not production code: Wallet mode authenticates sessions, never a header.
/// </summary>
internal sealed class TestOwnerAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "VesselIsolationTest";
    public const string Header = "X-Vessel-Test-Owner";

    public static string NameOf(Guid owner) => "Owner " + owner.ToString("N")[..8];

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(Header, out var value)) return Task.FromResult(AuthenticateResult.NoResult());
        if (!Guid.TryParseExact(value.ToString(), "D", out var owner) || owner == Guid.Empty)
            return Task.FromResult(AuthenticateResult.Fail("Invalid test owner."));
        var identity = JournalOwnerClaims.Identity(owner, NameOf(owner), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}

/// <summary>A settable clock shared by the API under test; venue fixtures observe at <see cref="AccountHistoryOrders.At"/> + 1 day.</summary>
internal sealed class IsolationClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = AccountHistoryOrders.At.AddDays(1);
    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>
/// The synthetic venues of the suite. Every read answers the same facts for any source, so two owners that follow
/// the same native address or account index import identical source fill, order and funding IDs.
/// </summary>
internal sealed class IsolationVenues
{
    public const string Address = "0x00000000000000000000000000000000000000a1";
    public const string Index = "7";
    public FundedReader Reader { get; } = new(AccountHistoryOrders.PublicReader());
    public AccountHistoryOrders Orders { get; } = new();
    public SecurityDiscovery Discovery { get; } = new([new(Index, "Main", "main"), new("8", "Sub", "subaccount")]);
    public SecurityVerifier Verifier { get; } = new();
    public FakeMarketStream Stream { get; } = new();
    public MarketReads Market { get; } = new();

    public VenueRegistry Registry() => new([VenueDescriptor.Manual, HyperliquidPerpetualReader.Descriptor, SecurityFixture.Venue],
        [Reader], [Orders], [Market], [Market], [Stream], [Discovery], [Verifier]);

    /// <summary>The existing public fixture reader, plus one settled funding payment inside its operation.</summary>
    internal sealed class FundedReader(FixtureReader fixture) : IPerpetualVenueReader, IVenueFundingReader
    {
        public const string FundingId = "funding-shared-1";
        public string VenueId => fixture.VenueId;
        public FixtureReader Fixture => fixture;
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) => fixture.ReadInstrumentsAsync(ct);
        public Task<PerpetualVenueReadResult> ReadAsync(string address, CancellationToken ct) => fixture.ReadAsync(address, ct);
        public Task<VenueFundingReadResult> ReadFundingAsync(Account account, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken ct) =>
            Task.FromResult(new VenueFundingReadResult([new(FundingId, "BTC", "BTC", -0.25m, "USDC", AccountHistoryOrders.At.AddSeconds(30), "{}")],
                fromUtc, toUtc, true, "Synthetic settled funding."));
    }

    /// <summary>Public candles and market context for any account that resolves; they hold no owner data.</summary>
    internal sealed class MarketReads : ICandleReader, IMarketContextReader
    {
        public string VenueId => "hyperliquid";
        public Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(string contractId, string interval, long fromMs, long toMs, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<VenueCandle>>([]);
        public Task<IReadOnlyList<VenueMarketContext>> ReadMarketContextsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<VenueMarketContext>>([new("BTC", "100", "100", "100", "99", "1000", "10", "0.0001", null)]);
    }
}

/// <summary>
/// One API over one isolated PostgreSQL schema, shared by a test class. Tests mint fresh owners per case, so they
/// stay independent while the class keeps a single factory. The bearer token is configured but never sent.
/// </summary>
public sealed class IsolationApi : IAsyncLifetime
{
    private CoreDatabase? database;
    private CoreApiFactory? factory;
    private AesGcmCredentialVault? vault;
    private readonly string evidenceRoot = Path.Combine(Path.GetTempPath(), "vessel-isolation-" + Guid.NewGuid().ToString("N"));

    internal IsolationVenues Venues { get; } = new();
    internal IsolationClock Clock { get; } = new();
    internal CoreDatabase Database => database ?? throw new InvalidOperationException("Set Vessel_TEST_POSTGRES to run the isolation suite.");
    internal CoreApiFactory Factory => factory ?? throw new InvalidOperationException("Set Vessel_TEST_POSTGRES to run the isolation suite.");
    internal ICredentialVault Vault => vault!;

    public async Task InitializeAsync()
    {
        // PostgresFact skips every case without a database; the fixture then stays empty.
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("Vessel_TEST_POSTGRES"))) return;
        database = await CoreDatabase.CreateAsync();
        vault = SecurityFixture.Vault();
        var registry = Venues.Registry();
        factory = new CoreApiFactory(Guid.NewGuid(), connection: database.ConnectionString, settings: new()
        {
            ["Vessel:Evidence:Storage:Local:RootPath"] = evidenceRoot,
            ["Vessel:Events:StreamPollSeconds"] = "1"
        }, configure: services =>
        {
            services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, TestOwnerAuthHandler>(TestOwnerAuthHandler.SchemeName, _ => { });
            services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultScheme = TestOwnerAuthHandler.SchemeName;
                options.DefaultAuthenticateScheme = TestOwnerAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestOwnerAuthHandler.SchemeName;
            });
            services.AddSingleton<IVenueRegistry>(registry);
            services.AddSingleton<TimeProvider>(Clock);
            services.AddSingleton<ICredentialVault>(vault);
        });
        _ = factory.Server;
    }

    public async Task DisposeAsync()
    {
        if (factory is not null) await factory.DisposeAsync();
        if (database is not null) await database.DisposeAsync();
        vault?.Dispose();
        if (Directory.Exists(evidenceRoot)) Directory.Delete(evidenceRoot, recursive: true);
    }

    /// <summary>Two fresh journal owners on this server.</summary>
    internal (Owner A, Owner B) Owners() => (Owner(), Owner());

    internal Owner Owner() => Owner(Guid.NewGuid());

    /// <summary>A client for a known owner, such as one whose rows a fixture seeded directly.</summary>
    internal Owner Owner(Guid id)
    {
        var client = Factory.CreateClient();
        // A stream answered where a 404 was expected must fail the case, not hang the run.
        client.Timeout = TimeSpan.FromSeconds(30);
        client.DefaultRequestHeaders.Add(TestOwnerAuthHandler.Header, id.ToString("D"));
        return new(id, client);
    }
}

/// <summary>An owner's HTTP client. Every request carries only the test owner header, never a bearer token.</summary>
internal sealed record Owner(Guid Id, HttpClient Http)
{
    public async Task<JsonElement> GetJson(string path)
    {
        using var response = await Http.GetAsync(path);
        return await Isolated.Json(response, HttpStatusCode.OK);
    }

    public async Task<string> GetText(string path)
    {
        using var response = await Http.GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"GET {path} answered {(int)response.StatusCode}: {body}");
        return body;
    }

    public async Task<JsonElement> Send(HttpMethod method, string path, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : JsonContent.Create(body) };
        using var response = await Http.SendAsync(request);
        return await Isolated.Json(response, expected);
    }

    public Task<JsonElement> Post(string path, object? body = null, HttpStatusCode expected = HttpStatusCode.OK) =>
        Send(HttpMethod.Post, path, body, expected);

    public async Task<Guid> Portfolio(string name)
    {
        var created = await Post("/api/portfolios", new CreatePortfolioRequest(name), HttpStatusCode.Created);
        return created.GetProperty("id").GetGuid();
    }

    public async Task<JsonElement> ManualAccount(string name, Guid? portfolio = null) =>
        await Post("/api/accounts", new CreateAccountRequest(portfolio, name, "manual", ManualAccountValueUsd: "100"), HttpStatusCode.Created);

    /// <summary>A Hyperliquid account on the shared synthetic address, refreshed once so its fills, orders and funding are retained.</summary>
    public async Task<JsonElement> SyncedVenueAccount(string name, Guid? portfolio = null)
    {
        var account = await Post("/api/accounts", new CreateAccountRequest(portfolio, name, "hyperliquid", IsolationVenues.Address), HttpStatusCode.Created);
        return await Post($"/api/accounts/{account.GetProperty("id").GetGuid()}/sync");
    }

    /// <summary>
    /// A planned Play on a synced account, opened and closed by explicitly linking the shared entry and exit orders.
    /// Its status changes append the owner's <c>play.opened</c> and <c>play.closed</c> events.
    /// </summary>
    public async Task<Guid> ClosedPlay(Guid account, string title)
    {
        var draft = await Post("/api/plays", new CreatePlayRequest(account, "BTC", "venue", title, TestPlays.Plan()), HttpStatusCode.Created);
        var id = draft.GetProperty("summary").GetProperty("id").GetGuid();
        await Post($"/api/plays/{id}/status", new ChangePlayStatusRequest(draft.GetProperty("summary").GetProperty("version").GetInt64(), "planned"));
        await Post($"/api/plays/{id}/execution/links", new LinkOrderRequest("entry", "entry", "entry-1"));
        await Post($"/api/plays/{id}/execution/links", new LinkOrderRequest("exit", "exit"));
        Assert.Equal("closed", (await GetJson($"/api/plays/{id}")).GetProperty("summary").GetProperty("status").GetString());
        return id;
    }

    /// <summary>A Lighter-style account on the shared synthetic account index.</summary>
    public async Task<JsonElement> IndexAccount(string name) =>
        await Post("/api/accounts", new CreateAccountRequest(null, name, SecurityFixture.Venue.Id, SourceId: IsolationVenues.Index), HttpStatusCode.Created);
}

/// <summary>Assertions shared by the isolation cases.</summary>
internal static class Isolated
{
    public static async Task<JsonElement> Json(HttpResponseMessage response, HttpStatusCode expected)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected,
            $"{response.RequestMessage?.Method} {response.RequestMessage?.RequestUri?.PathAndQuery} answered {(int)response.StatusCode}, expected {(int)expected}: {body}");
        return body.Length == 0 ? default : JsonDocument.Parse(body).RootElement.Clone();
    }

    /// <summary>A unique marker for names, titles and notes, so leaks can be found in any response body.</summary>
    public static string Marker(string label) => $"{label}-{Guid.NewGuid():N}";

    /// <summary>
    /// Sends the same request with the other owner's ID and with a random unknown ID. Both must answer the same status
    /// and the same body: ProblemDetails <c>title</c>, <c>detail</c>, <c>code</c> and everything else except the
    /// per-response <c>traceId</c> (the <c>X-Correlation-ID</c> header is not compared). A response may echo the ID the
    /// caller sent, so each body is compared with its own ID replaced. Returns the shared status.
    /// </summary>
    public static async Task<HttpStatusCode> SameAsUnknown(Owner caller, Guid foreign, Func<Guid, HttpRequestMessage> request)
    {
        var unknown = Guid.NewGuid();
        using var foreignRequest = request(foreign);
        using var unknownRequest = request(unknown);
        using var foreignResponse = await caller.Http.SendAsync(foreignRequest);
        using var unknownResponse = await caller.Http.SendAsync(unknownRequest);
        var foreignBody = await foreignResponse.Content.ReadAsStringAsync();
        var unknownBody = await unknownResponse.Content.ReadAsStringAsync();
        var what = $"{foreignRequest.Method} {foreignRequest.RequestUri}";
        Assert.True(foreignResponse.StatusCode == unknownResponse.StatusCode,
            $"{what}: foreign ID answered {(int)foreignResponse.StatusCode} ({foreignBody}), unknown ID {(int)unknownResponse.StatusCode} ({unknownBody}).");
        Assert.Equal(unknownResponse.Content.Headers.ContentType?.MediaType, foreignResponse.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Comparable(unknownBody, unknown), Comparable(foreignBody, foreign));
        return foreignResponse.StatusCode;
    }

    /// <summary>As <see cref="SameAsUnknown"/>, and the shared answer is 404.</summary>
    public static async Task NotFound(Owner caller, Guid foreign, Func<Guid, HttpRequestMessage> request) =>
        Assert.Equal(HttpStatusCode.NotFound, await SameAsUnknown(caller, foreign, request));

    public static Func<Guid, HttpRequestMessage> Request(HttpMethod method, Func<Guid, string> path, Func<Guid, object?>? body = null) =>
        id => new(method, path(id)) { Content = body?.Invoke(id) is { } content ? JsonContent.Create(content) : null };

    private static string Comparable(string body, Guid sent)
    {
        if (body.Length == 0) return body;
        var node = JsonNode.Parse(body);
        if (node is JsonObject problem) problem.Remove("traceId");
        return (node?.ToJsonString() ?? "null").Replace(sent.ToString("D"), "{sent-id}", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The body contains none of the other owner's IDs or markers.</summary>
    public static void NoLeak(string body, params object[] foreign)
    {
        foreach (var value in foreign)
        {
            var text = value is Guid id ? id.ToString("D") : value.ToString()!;
            Assert.False(body.Contains(text, StringComparison.OrdinalIgnoreCase), $"The response leaks {text}: {body}");
        }
    }

    /// <summary>Reads the owner's state through its own client; mutation attempts by another owner must leave it byte-identical.</summary>
    public static async Task<string> State(Owner owner, params string[] paths)
    {
        var parts = new List<string>();
        foreach (var path in paths) parts.Add(path + " " + await owner.GetText(path));
        return string.Join("\n", parts);
    }
}

/// <summary>Names a route (method and pattern as registered) that the annotated isolation case exercises across two owners.</summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
internal sealed class CoversAttribute(string method, string route) : Attribute
{
    public string Route { get; } = method + " " + route;
}
