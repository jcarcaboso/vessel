using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Configuration;
using Vessel.Api;

namespace Vessel.Tests;

public sealed class ProductionHardeningTests
{
    private static IConfiguration Config(string? token, string? connection, string? owner = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Vessel:Auth:Token"] = token, ["Vessel:Auth:OwnerId"] = owner, ["ConnectionStrings:Vessel"] = connection,
        }).Build();

    [Fact]
    public void Production_requires_a_strong_token_an_owner_and_a_database_without_echoing_values()
    {
        const string weak = "short-secret-value";
        var error = Assert.Throws<InvalidOperationException>(() => ProductionConfiguration.Validate(Config(weak, null, "not-a-guid")));
        Assert.Contains("Vessel__Auth__Token", error.Message);
        Assert.Contains("Vessel__Auth__OwnerId", error.Message);
        Assert.Contains("ConnectionStrings__Vessel", error.Message);
        Assert.DoesNotContain(weak, error.Message);
        Assert.Throws<InvalidOperationException>(() => ProductionConfiguration.Validate(Config(null, "Host=db")));
        ProductionConfiguration.Validate(Config(new string('k', ProductionConfiguration.MinimumTokenLength), "Host=db", Guid.NewGuid().ToString()));
    }

    [Fact]
    public async Task Repeated_wrong_tokens_lock_out_the_client_with_retry_after()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        using var wrong = factory.CreateClient();
        wrong.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong-token");
        for (var i = 0; i < Vessel.Infrastructure.Auth.AuthFailureLimiter.MaxFailures; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync("/api/system")).StatusCode);
        using var locked = await wrong.GetAsync("/api/system");
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.True(locked.Headers.RetryAfter?.Delta > TimeSpan.Zero);
        // The right token from the same client waits too, so guessing cannot continue in parallel.
        using var right = factory.AuthorizedClient();
        Assert.Equal(HttpStatusCode.TooManyRequests, (await right.GetAsync("/api/system")).StatusCode);
    }

    [Fact]
    public async Task Missing_header_is_not_counted_as_a_failed_guess()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        using var anonymous = factory.CreateClient();
        for (var i = 0; i < Vessel.Infrastructure.Auth.AuthFailureLimiter.MaxFailures + 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/system")).StatusCode);
        using var right = factory.AuthorizedClient();
        Assert.Equal(HttpStatusCode.OK, (await right.GetAsync("/api/system")).StatusCode);
    }

    [Fact]
    public async Task Responses_carry_security_headers_and_api_data_is_not_cached()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        using var client = factory.AuthorizedClient();
        using var response = await client.GetAsync("/api/system");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.True(response.Headers.CacheControl!.NoStore);
    }

    [Fact]
    public async Task Readiness_is_anonymous_and_reports_unavailable_without_a_database()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("""{"status":"unavailable"}""", await response.Content.ReadAsStringAsync());
    }

    [PostgresFact]
    public async Task Readiness_reports_ready_once_the_database_is_migrated()
    {
        await using var database = await CoreDatabase.CreateAsync();
        await using var factory = new CoreApiFactory(Guid.NewGuid(), connection: database.ConnectionString);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }
}
