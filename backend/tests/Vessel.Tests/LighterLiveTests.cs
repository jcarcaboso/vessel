using Vessel.Application.Credentials;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Venues.Lighter;

namespace Vessel.Tests;

public sealed class LighterLiveFactAttribute : FactAttribute
{
    public LighterLiveFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("Vessel_TEST_LIGHTER_PUBLIC") != "1")
            Skip = "Set Vessel_TEST_LIGHTER_PUBLIC=1 for bounded public Lighter reads.";
    }
}

/// <summary>No token is read from the environment. Public mainnet only, with no account writes or history backfill.</summary>
public sealed class LighterLiveTests
{
    private sealed class NoCredential : IAccountCredentialReader
    {
        public Task<string?> ReadAsync(Guid accountId, CancellationToken ct) =>
            throw new InvalidOperationException("The public overload must never look up credentials.");
        public Task MarkRefusedAsync(Guid accountId, CancellationToken ct) =>
            throw new InvalidOperationException("The public overload must never change credentials.");
    }

    [LighterLiveFact]
    public async Task Public_catalogue_empty_system_account_and_three_candles_parse()
    {
        using var client = new HttpClient(new LighterAuthenticationHandler { InnerHandler = new HttpClientHandler { AllowAutoRedirect = false } })
        {
            BaseAddress = new Uri("https://mainnet.zklighter.elliot.ai/"), Timeout = TimeSpan.FromSeconds(20)
        };
        var reader = new LighterReader(client, TimeProvider.System, new NoCredential());
        var catalogue = await reader.ReadInstrumentsAsync(default);
        Assert.Contains(catalogue, i => i.ContractId == "BTC" && i.PriceStep > 0);
        Assert.DoesNotContain(catalogue, i => i.ContractId.Contains('/'));
        // Core concepts identifies 0-2 as system accounts. Account 1 has no recent executions.
        var result = await reader.ReadAsync("1", default);
        Assert.Equal("lighter-perps-account", result.Snapshot.ValueScope);
        Assert.All(result.Fills, f => Assert.True(VenueFactChecks.Valid(f)));
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var candles = await reader.ReadCandlesAsync("BTC", "1h", now - 2 * 3600000L, now, default);
        Assert.InRange(candles.Count, 1, 3);
        Assert.All(candles, c => Assert.Null(c.Trades));
    }
}
