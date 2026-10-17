using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Vessel.Tests.Isolation;

/// <summary>
/// Every mapped route is either named by a two-owner isolation case (<see cref="CoversAttribute"/>) or listed below
/// with the reason it holds no owner data. A new route fails this test until someone decides which it is.
/// </summary>
public sealed class EndpointInventoryTests(IsolationApi api) : IClassFixture<IsolationApi>
{
    /// <summary>Routes without owner-scoped data. Each entry says why.</summary>
    private static readonly Dictionary<string, string> Exempt = new()
    {
        // Anonymous liveness: a constant body, no database, no owner.
        ["GET /health/live"] = "anonymous health",
        // Anonymous readiness: database and migration state only, never owner rows.
        ["GET /health/ready"] = "anonymous health",
        // Development-only OpenAPI document: the API's shape, generated from code, never owner data.
        ["GET /openapi/{documentName}.json"] = "development API description",
    };

    /// <summary>
    /// Built by lanes A1/A2 in parallel; not present on this base. Their isolation cases are skipped "pending A2"
    /// in <see cref="AuthIsolationTests"/>.
    /// </summary>
    private const string PendingAuthPrefix = "/api/auth/";

    private static IEnumerable<string> Routes(IServiceProvider services) =>
        services.GetServices<EndpointDataSource>().SelectMany(source => source.Endpoints).OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["*"])
                .Select(method => $"{method} {Normalize(endpoint.RoutePattern.RawText)}"))
            .Distinct().Order(StringComparer.Ordinal);

    private static string Normalize(string? pattern) => "/" + (pattern ?? "").Trim('/');

    private static HashSet<string> Covered() => typeof(EndpointInventoryTests).Assembly.GetTypes()
        .Where(type => type.Namespace == typeof(EndpointInventoryTests).Namespace)
        .SelectMany(type => type.GetMethods(BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
        .Where(method => method.GetCustomAttributes<FactAttribute>().Any())
        .SelectMany(method => method.GetCustomAttributes<CoversAttribute>()).Select(covers => covers.Route).ToHashSet(StringComparer.Ordinal);

    [PostgresFact]
    public void Every_route_is_covered_or_explicitly_exempt()
    {
        var routes = Routes(api.Factory.Services).ToList();
        var covered = Covered();
        Assert.NotEmpty(routes);
        var missing = routes.Where(route => !covered.Contains(route) && !Exempt.ContainsKey(route) &&
            !route[(route.IndexOf(' ') + 1)..].StartsWith(PendingAuthPrefix, StringComparison.Ordinal)).ToList();
        Assert.True(missing.Count == 0, "Routes without an isolation case or exemption:\n" + string.Join("\n", missing));
        // Stale names would claim coverage of a route that no longer exists.
        var stale = covered.Concat(Exempt.Keys).Where(route => !routes.Contains(route)).ToList();
        Assert.True(stale.Count == 0, "Coverage or exemptions for routes that are not mapped:\n" + string.Join("\n", stale));
    }

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
}
