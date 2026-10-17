using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Nethereum.Signer;
using Vessel.Application.Credentials;
using Vessel.Application.MarketData;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Infrastructure.Venues.Hyperliquid;
using Vessel.Tests.Identity;

namespace Vessel.Tests;

public sealed class UserVenueReadLimitTests
{
    [PostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Both_auth_modes_return_429_with_retry_after_for_all_per_user_caps(bool wallet)
    {
        await using var identity = await IdentityDatabase.CreateAsync();
        var key = EthECKey.GenerateKey();
        var owner = (await identity.SeedAsync(key)).User.Id;
        var store = new MemoryWorkspaceStore(owner);
        var marketAccount = new Account(Guid.NewGuid(), owner, "hyperliquid", "Synthetic market account");
        var credentialAccount = SecurityFixture.Account(owner);
        store.Accounts.AddRange([marketAccount, credentialAccount]);
        using var vault = SecurityFixture.Vault();
        var state = new MonitorServerState();
        var candles = new Candles();
        var registry = new VenueRegistry([VenueDescriptor.Manual, HyperliquidPerpetualReader.Descriptor, SecurityFixture.Venue],
            [new FixtureReader()], [], [candles], [], [new FakeMarketStream()], [new SecurityDiscovery([])], [new SecurityVerifier()]);
        void Configure(IServiceCollection services)
        {
            services.AddSingleton<IWorkspaceStore>(store);
            services.AddSingleton<IUnitOfWork>(TestUnitOfWork.None);
            services.AddSingleton<IServerStateStore>(state);
            services.AddSingleton<IVenueRegistry>(registry);
            services.AddSingleton<ICredentialVault>(vault);
            services.AddSingleton<IAccountCredentialStore>(new SecurityCredentialStore());
            services.AddSingleton<TimeProvider>(SecurityFixture.Clock);
        }
        await using var factory = wallet ? IdentityHttpTest.Factory(identity, owner, configure: Configure)
            : new CoreApiFactory(owner, store, connection: identity.Connection, configure: Configure);
        using var client = wallet ? IdentityHttpTest.Client(factory) : factory.AuthorizedClient();
        if (wallet) await IdentityHttpTest.SignInAsync(client, key);

        var limiter = factory.Services.GetRequiredService<MarketStreamLimiter>();
        var leases = Enumerable.Range(0, 4).Select(_ => limiter.TryAcquire(owner)!).ToArray();
        try
        {
            using var rejected = await client.GetAsync($"/api/accounts/{marketAccount.Id}/market-stream?instrument=BTC&interval=1m");
            await LimitedAsync(rejected, 5);
        }
        finally { foreach (var lease in leases) lease.Dispose(); }

        var candleUrl = $"/api/accounts/{marketAccount.Id}/candles?instrument=BTC&interval=1h&refresh=true";
        (await client.GetAsync(candleUrl)).EnsureSuccessStatusCode();
        using (var rejected = await client.GetAsync(candleUrl + "&endTime=100000000")) await LimitedAsync(rejected, 60);
        // A different series has its own budget. A normal read never spends the manual-refresh budget.
        (await client.GetAsync(candleUrl.Replace("interval=1h", "interval=1m", StringComparison.Ordinal))).EnsureSuccessStatusCode();
        (await client.GetAsync(candleUrl.Replace("refresh=true", "refresh=false", StringComparison.Ordinal))).EnsureSuccessStatusCode();

        for (var index = 0; index < 5; index++)
        {
            (await client.GetAsync($"/api/venues/{SecurityFixture.Venue.Id}/accounts?address={SecurityFixture.Address}")).EnsureSuccessStatusCode();
            (await client.PutAsJsonAsync($"/api/accounts/{credentialAccount.Id}/credential", new { token = SecurityFixture.Token })).EnsureSuccessStatusCode();
        }
        using (var rejected = await client.GetAsync($"/api/venues/{SecurityFixture.Venue.Id}/accounts?address={SecurityFixture.Address}"))
            await LimitedAsync(rejected, 60);
        using (var rejected = await client.PutAsJsonAsync($"/api/accounts/{credentialAccount.Id}/credential", new { token = SecurityFixture.Token }))
            await LimitedAsync(rejected, 60);

        // Public reads have their own backoff, not the account-read server deadline.
        await state.DeferVenueAsync("hyperliquid", SecurityFixture.Now.AddMinutes(5), SecurityFixture.Now, default);
        (await client.GetAsync(candleUrl.Replace("interval=1h", "interval=5m", StringComparison.Ordinal))).EnsureSuccessStatusCode();
        candles.Error = new VenueRateLimitException(SecurityFixture.Now.AddMinutes(10));
        Assert.Equal(502, (int)(await client.GetAsync(candleUrl.Replace("interval=1h", "interval=15m", StringComparison.Ordinal))).StatusCode);
        Assert.Equal(SecurityFixture.Now.AddMinutes(5), await state.VenueRetryAtAsync("hyperliquid", default));
    }

    [Fact]
    public void Stream_budgets_are_per_user_and_process_and_idempotently_released()
    {
        var limiter = new MarketStreamLimiter();
        var first = Guid.NewGuid(); var second = Guid.NewGuid();
        var leases = Enumerable.Range(0, 4).Select(_ => limiter.TryAcquire(first)!).ToList();
        Assert.Null(limiter.TryAcquire(first));
        leases.AddRange(Enumerable.Range(0, 4).Select(_ => limiter.TryAcquire(second)!));
        Assert.Null(limiter.TryAcquire(Guid.NewGuid()));
        Assert.Equal(8, limiter.Active);
        leases[0].Dispose(); leases[0].Dispose();
        Assert.Equal(7, limiter.Active);
        leases.Add(limiter.TryAcquire(first)!);
        Assert.Equal(8, limiter.Active);
        foreach (var lease in leases) lease.Dispose();
        Assert.Equal(0, limiter.Active);
    }

    [Fact]
    public void Account_and_candle_windows_do_not_leak_between_users_and_expire_after_one_minute()
    {
        var clock = new ManualTime(SecurityFixture.Now);
        var limits = new UserReadLimits(clock);
        var first = Guid.NewGuid(); var second = Guid.NewGuid();
        for (var index = 0; index < 10; index++) limits.Admit(first, "account-reads", 10);
        Assert.Equal(60, Assert.Throws<Vessel.Application.Common.ProblemException>(() => limits.Admit(first, "account-reads", 10)).RetryAfterSeconds);
        limits.Admit(second, "account-reads", 10);
        limits.Admit(first, "hyperliquid|BTC|1h", 1);
        limits.Admit(second, "hyperliquid|BTC|1h", 1);
        clock.Advance(TimeSpan.FromSeconds(59));
        Assert.Equal(1, Assert.Throws<Vessel.Application.Common.ProblemException>(() => limits.Admit(first, "hyperliquid|BTC|1h", 1)).RetryAfterSeconds);
        clock.Advance(TimeSpan.FromSeconds(1));
        limits.Admit(first, "account-reads", 10);
        limits.Admit(first, "hyperliquid|BTC|1h", 1);
    }

    private static async Task LimitedAsync(HttpResponseMessage response, int seconds)
    {
        Assert.Equal(429, (int)response.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(seconds), response.Headers.RetryAfter?.Delta);
        Assert.Equal("rate-limited", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    private sealed class Candles : ICandleReader
    {
        public string VenueId => "hyperliquid";
        public Exception? Error { get; set; }
        public Task<IReadOnlyList<VenueCandle>> ReadCandlesAsync(string contractId, string interval, long fromMs, long toMs, CancellationToken ct) =>
            Error is { } error ? Task.FromException<IReadOnlyList<VenueCandle>>(error) : Task.FromResult<IReadOnlyList<VenueCandle>>([]);
    }
}
