using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Credentials;
using Vessel.Application.Venues;

namespace Vessel.Tests;

public sealed class CredentialTransportApiTests
{
    [Theory]
    // Direct plaintext from another machine, with or without a spoofed forwarded scheme.
    [InlineData("http://vessel.example.invalid", "192.0.2.10", null, null, false)]
    [InlineData("http://vessel.example.invalid", "192.0.2.10", "https", null, false)]
    [InlineData("http://localhost", "192.0.2.10", "https", null, false)]
    // Same-host plaintext proxy for a LAN origin keeps the LAN host or forwards the LAN client.
    [InlineData("http://10.1.0.219:5180", "127.0.0.1", null, null, false)]
    [InlineData("http://localhost", "127.0.0.1", "http", "192.0.2.10", false)]
    // Loopback development, HTTPS, and a same-host TLS-terminating proxy.
    [InlineData("http://localhost", "127.0.0.1", null, null, true)]
    [InlineData("http://[::1]", "::1", null, null, true)]
    [InlineData("https://vessel.example.invalid", "192.0.2.10", null, null, true)]
    [InlineData("http://vessel.example.invalid", "127.0.0.1", "https", "192.0.2.10", true)]
    public async Task Token_bearing_credential_requests_need_https_outside_loopback(string origin, string peer, string? forwardedProto, string? forwardedFor, bool allowed)
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var account = SecurityFixture.Account(owner); store.Accounts.Add(account);
        var credentials = new SecurityCredentialStore(); using var vault = SecurityFixture.Vault();
        var verifier = new CountingVerifier(); var discovery = new SecurityDiscovery([new("123", "Main", "main")]);
        await using var factory = new CoreApiFactory(owner, store, configure: services =>
        {
            services.AddSingleton<IVenueRegistry>(SecurityFixture.Registry()); services.AddSingleton<ICredentialVault>(vault);
            services.AddSingleton<IAccountCredentialStore>(credentials); services.AddSingleton<IVenueCredentialVerifier>(verifier);
            services.AddSingleton<IVenueAccountDiscovery>(discovery); services.AddSingleton(SecurityFixture.Clock);
            services.AddSingleton<IStartupFilter>(new Peer(IPAddress.Parse(peer)));
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(origin), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CoreApiFactory.Token);
        if (forwardedProto is not null) client.DefaultRequestHeaders.Add("X-Forwarded-Proto", forwardedProto);
        if (forwardedFor is not null) client.DefaultRequestHeaders.Add("X-Forwarded-For", forwardedFor);

        using var save = await client.PutAsJsonAsync($"/api/accounts/{account.Id}/credential", new { token = SecurityFixture.Token });
        using var preview = await client.PostAsJsonAsync($"/api/venues/{SecurityFixture.Venue.Id}/accounts/credential",
            new { address = SecurityFixture.Address, token = SecurityFixture.Token });
        if (allowed)
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
            Assert.Equal(1, verifier.Calls); Assert.Equal(SecurityFixture.Token, discovery.ReceivedToken);
        }
        else
        {
            Assert.Equal(HttpStatusCode.Forbidden, save.StatusCode); Assert.Equal(HttpStatusCode.Forbidden, preview.StatusCode);
            Assert.True(save.Headers.CacheControl!.NoStore);
            Assert.Equal(0, verifier.Calls); Assert.Null(discovery.ReceivedToken); Assert.Null(credentials.Stored);
            Assert.DoesNotContain(SecurityFixture.Token, await save.Content.ReadAsStringAsync());
            // Metadata reads and removal carry no token and stay available.
            using var metadata = await client.GetAsync($"/api/accounts/{account.Id}/credential");
            Assert.Equal(HttpStatusCode.OK, metadata.StatusCode);
            using var removed = await client.DeleteAsync($"/api/accounts/{account.Id}/credential");
            Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        }
    }

    private sealed class Peer(IPAddress address) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, proceed) => { context.Connection.RemoteIpAddress = address; return proceed(); });
            next(app);
        };
    }

    private sealed class CountingVerifier : IVenueCredentialVerifier
    {
        public int Calls { get; private set; }
        public string VenueId => SecurityFixture.Venue.Id;
        public Task<VerifiedVenueCredential> VerifyAsync(string sourceId, string token, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new VerifiedVenueCredential("single", SecurityFixture.Now.AddDays(60)));
        }
    }
}
