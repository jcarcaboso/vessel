using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Vessel.Tests.Isolation;

/// <summary>
/// Every route mapped by the Token-mode and the Wallet-mode host is either named by a two-owner isolation case
/// (<see cref="CoversAttribute"/>) or listed below, exactly, with the reason it holds no owner data. A new route fails
/// this test until someone decides which it is. Each host is inventoried as it starts: Token mode maps a catch-all in
/// place of the session routes, so only the Wallet-mode host shows them.
/// </summary>
public sealed class EndpointInventoryTests(IsolationApi api, WalletIsolationApi wallet)
    : IClassFixture<IsolationApi>, IClassFixture<WalletIsolationApi>
{
    /// <summary>Routes of both hosts without owner-scoped data. Each entry says why.</summary>
    private static readonly Dictionary<string, string> Exempt = new()
    {
        // Anonymous liveness: a constant body, no database, no owner.
        ["GET /health/live"] = "anonymous health",
        // Anonymous readiness: database and migration state only, never owner rows.
        ["GET /health/ready"] = "anonymous health",
        // Development-only OpenAPI document: the API's shape, generated from code, never owner data.
        ["GET /openapi/{documentName}.json"] = "development API description",
        // The mode and, in Wallet mode, the effective registration policy and an origin hint; anonymous by design.
        ["GET /api/auth/config"] = "public auth configuration",
    };

    /// <summary>Routes only the Token-mode host maps.</summary>
    private static readonly Dictionary<string, string> TokenExempt = new()
    {
        // Every other auth path answers 404 not-found in Token mode, anonymous requests included; no handler reads data.
        ["* /api/auth/{**rest}"] = "Token-mode auth catch-all",
    };

    /// <summary>Routes only the Wallet-mode host maps.</summary>
    private static readonly Dictionary<string, string> WalletExempt = new()
    {
        // Public sign-in routes run before any session and are anonymous by design (contract §6, §7). They read users,
        // wallets and the allow-list only after a valid signature and return only the signer's own session.
        ["POST /api/auth/challenge"] = "public sign-in",
        ["POST /api/auth/verify"] = "public sign-in",
        ["POST /api/auth/register"] = "public sign-in",
    };

    private static List<string> Routes(IServiceProvider services) =>
        services.GetServices<EndpointDataSource>().SelectMany(source => source.Endpoints).OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["*"])
                .Select(method => $"{method} {Normalize(endpoint.RoutePattern.RawText)}"))
            .Distinct().Order(StringComparer.Ordinal).ToList();

    private static string Normalize(string? pattern) => "/" + (pattern ?? "").Trim('/');

    private static HashSet<string> Covered() => typeof(EndpointInventoryTests).Assembly.GetTypes()
        .Where(type => type.Namespace == typeof(EndpointInventoryTests).Namespace)
        .SelectMany(type => type.GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
        .Where(method => method.GetCustomAttributes<FactAttribute>().Any())
        .SelectMany(method => method.GetCustomAttributes<CoversAttribute>()).Select(covers => covers.Route).ToHashSet(StringComparer.Ordinal);

    [PostgresFact]
    public void Every_route_of_both_modes_is_covered_or_exactly_exempt()
    {
        var token = Routes(api.Factory.Services);
        var walletRoutes = Routes(wallet.Factory.Services);
        var covered = Covered();
        Assert.NotEmpty(token);
        foreach (var (mode, routes, exempt) in new[] { ("Token", token, TokenExempt), ("Wallet", walletRoutes, WalletExempt) })
        {
            var missing = routes.Where(route => !covered.Contains(route) && !Exempt.ContainsKey(route) && !exempt.ContainsKey(route)).ToList();
            Assert.True(missing.Count == 0, $"{mode}-mode routes without an isolation case or exemption:\n" + string.Join("\n", missing));
            // A mode's exemption must name a route that mode maps.
            var unmapped = exempt.Keys.Concat(Exempt.Keys).Where(route => !routes.Contains(route)).ToList();
            Assert.True(unmapped.Count == 0, $"{mode}-mode exemptions for routes it does not map:\n" + string.Join("\n", unmapped));
        }
        // Stale names would claim coverage of a route that neither mode maps.
        var stale = covered.Where(route => !token.Contains(route) && !walletRoutes.Contains(route)).ToList();
        Assert.True(stale.Count == 0, "Coverage for routes that are not mapped:\n" + string.Join("\n", stale));
        // Outside /api/auth both modes map the same journal routes, so the journal cases cover both.
        static IEnumerable<string> Journal(IEnumerable<string> routes) =>
            routes.Where(route => !route[(route.IndexOf(' ') + 1)..].StartsWith("/api/auth/", StringComparison.Ordinal));
        Assert.Equal(Journal(token), Journal(walletRoutes));
        // Every session route exists only in Wallet mode and is covered there, never exempt.
        var session = walletRoutes.Where(route => route[(route.IndexOf(' ') + 1)..].StartsWith("/api/auth/", StringComparison.Ordinal) &&
            !Exempt.ContainsKey(route) && !WalletExempt.ContainsKey(route)).ToList();
        Assert.Equal(SessionRoutes.Order(StringComparer.Ordinal), session);
        Assert.All(session, route => Assert.Contains(route, covered));
    }

    /// <summary>The session routes of contract §6, which require a live session and are covered by two-user cases.</summary>
    private static readonly string[] SessionRoutes =
    [
        "GET /api/auth/session", "POST /api/auth/sign-out", "GET /api/auth/sessions", "DELETE /api/auth/sessions/{id}",
        "POST /api/auth/sessions/revoke-others", "PATCH /api/auth/profile", "GET /api/auth/wallets",
        "POST /api/auth/step-up/challenge", "POST /api/auth/step-up", "POST /api/auth/wallets/challenge", "POST /api/auth/wallets",
        "PATCH /api/auth/wallets/{id}", "DELETE /api/auth/wallets/{id}"
    ];

    [PostgresFact]
    [Covers("GET", "/api/system")]
    public async Task Test_scheme_selects_the_owner_and_issues_the_production_claims()
    {
        var (a, b) = await api.Owners();
        foreach (var owner in new[] { a, b })
        {
            var system = await owner.GetJson("/api/system");
            Assert.Equal(owner.Id, system.GetProperty("owner").GetProperty("id").GetGuid());
            Assert.Equal(TestOwnerAuthHandler.NameOf(owner.Id), system.GetProperty("owner").GetProperty("displayName").GetString());
        }
        Assert.NotEqual(a.Id, b.Id);
    }

    [PostgresFact]
    public async Task Bearer_path_is_not_used_and_requests_without_an_owner_are_rejected()
    {
        using var anonymous = api.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/portfolios")).StatusCode);
        // The configured token would authenticate the default scheme of other API tests; here it is ignored.
        anonymous.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CoreApiFactory.Token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/portfolios")).StatusCode);
        using var invalid = api.Factory.CreateClient();
        invalid.DefaultRequestHeaders.Add(TestOwnerAuthHandler.Header, Guid.Empty.ToString("D"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await invalid.GetAsync("/api/portfolios")).StatusCode);
    }

    [PostgresFact]
    [Covers("GET", "/api/system")]
    public async Task Session_scheme_selects_the_signed_in_user_as_owner()
    {
        var (a, b) = await wallet.Owners();
        foreach (var owner in new[] { a, b })
        {
            var system = await owner.GetJson("/api/system");
            Assert.Equal(owner.Id, system.GetProperty("owner").GetProperty("id").GetGuid());
            Assert.Equal(owner.Id, (await owner.GetJson("/api/auth/session")).GetProperty("user").GetProperty("id").GetGuid());
        }
        Assert.NotEqual(a.Id, b.Id);
        // No bearer scheme is registered in Wallet mode: the configured test token authenticates nobody.
        using var bearer = wallet.Client();
        bearer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CoreApiFactory.Token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await bearer.GetAsync("/api/portfolios")).StatusCode);
    }
}
