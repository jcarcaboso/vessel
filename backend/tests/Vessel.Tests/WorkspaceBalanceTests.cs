using Vessel.Application.Venues;
using System.Net.Http.Json;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

public sealed class WorkspaceBalanceTests
{
    private readonly Guid owner = Guid.NewGuid();
    private readonly MemoryWorkspaceStore store;
    private readonly WorkspaceService service;

    public WorkspaceBalanceTests()
    {
        store = new(owner);
        var nonWallet = new VenueDescriptor("public-perps", "Public perps", "read-only", VenueSources.EvmAddress,
            VenueCapabilities.None with { Sync = true });
        service = new(store, new CoreOwner(owner),
            new VenueRegistry([VenueDescriptor.Manual, Vessel.Infrastructure.Venues.Hyperliquid.HyperliquidPerpetualReader.Descriptor, nonWallet],
                [], [], [], [], []));
    }

    private Account Add(Guid? portfolio, string venue, decimal? equity, decimal? withdrawable = null,
        string? mode = null, decimal? walletTotal = null, decimal? walletAvailable = null, bool enabled = true)
    {
        var account = new Account(Guid.NewGuid(), owner, venue, "Fixture account");
        account.Configure(portfolio, null, venue == "manual" ? equity : null);
        if (!enabled) account.UpdateSettings(account.Name, portfolio, false);
        store.Accounts.Add(account);
        if (venue != "manual")
            store.Snapshots.Add(new AccountSnapshot
            {
                OwnerId = owner, AccountId = account.Id, ObservedAtUtc = DateTimeOffset.UtcNow, ValueScope = "fixture",
                AccountValueUsd = equity, WithdrawableUsd = withdrawable, AccountMode = mode,
                StablecoinsObservedAtUtc = walletTotal.HasValue ? DateTimeOffset.UtcNow : null,
                Stablecoins = walletTotal is { } total
                    ? [new() { Total = total, Held = total - (walletAvailable ?? total), Available = walletAvailable ?? total }]
                    : [],
            });
        return account;
    }

    [Fact]
    public async Task Overview_combines_enabled_balances_across_portfolios_and_unassigned_without_counting_ledgers_twice()
    {
        var first = await service.CreatePortfolioAsync(new("First"), default);
        var second = await service.CreatePortfolioAsync(new("Second"), default);
        Add(first.Id, "hyperliquid", 999m, 888m, "unifiedAccount", 100m, 80m);
        Add(second.Id, "hyperliquid", 40m, 35m, "default", 10m, 7m);
        Add(null, "manual", 25m);
        Add(second.Id, "public-perps", 30m, 20m);
        Add(null, "public-perps", null); // Lighter-like unknown equity/withdrawal: collateral is not equity.
        Add(null, "hyperliquid", 500m, 400m, "portfolioMargin", 200m, 150m, enabled: false);
        Add(null, "manual", 1000m, enabled: false);

        var totals = (await service.OverviewAsync(default)).Totals;
        Assert.Equal(7, totals.AccountCount);
        Assert.Equal(5, totals.EnabledAccountCount);
        Assert.Equal("205", totals.TotalBalanceUsd);
        Assert.Equal(4, totals.BalanceAccountCount);
        Assert.Equal("partial", totals.BalanceCoverage);
        // Wallet accounts contribute wallet availability only, not their perps withdrawal as well.
        Assert.Equal("107", totals.AvailableBalanceUsd);
        Assert.Equal(3, totals.AvailableBalanceAccountCount);
        Assert.Equal("partial", totals.AvailableBalanceCoverage);
        Assert.Equal("87", totals.AvailableStablecoinNominalUsd);
        Assert.Equal(2, totals.StablecoinAccountCount);
    }

    [Fact]
    public async Task Moving_disabling_and_reenabling_a_unified_account_recomputes_portfolio_balance_and_counts()
    {
        var first = await service.CreatePortfolioAsync(new("First"), default);
        var second = await service.CreatePortfolioAsync(new("Second"), default);
        var account = Add(first.Id, "hyperliquid", 0m, 0m, "unifiedAccount", 750m, 600m);
        await service.UpdateAccountAsync(account.Id, new(account.Name, second.Id, true, account.SettingsRevision), default);
        var portfolios = await service.PortfoliosAsync(default);
        Assert.Equal((0, (string?)null), (portfolios[0].AccountCount, portfolios[0].BalanceUsd));
        Assert.Equal((1, "750", "complete"), (portfolios[1].AccountCount, portfolios[1].BalanceUsd, portfolios[1].BalanceCoverage));
        Assert.Equal("0", portfolios[1].TotalValueUsd);
        await service.UpdateAccountAsync(account.Id, new(account.Name, second.Id, false, account.SettingsRevision), default);
        Assert.Null((await service.PortfolioAsync(second.Id, default)).BalanceUsd);
        Assert.Equal(1, (await service.PortfolioAsync(second.Id, default)).AccountCount);
        Assert.Null((await service.OverviewAsync(default)).Totals.TotalBalanceUsd);
        await service.UpdateAccountAsync(account.Id, new(account.Name, null, true, account.SettingsRevision), default);
        Assert.Equal("750", (await service.OverviewAsync(default)).Totals.TotalBalanceUsd);
        Assert.Equal(0, (await service.PortfolioAsync(second.Id, default)).AccountCount);
    }

    [Fact]
    public async Task Balance_sums_are_exact_even_when_a_single_account_exceeds_decimal_precision()
    {
        var portfolio = await service.CreatePortfolioAsync(new("Exact"), default);
        var account = Add(portfolio.Id, "hyperliquid", decimal.MaxValue, null, "default",
            0.0000000000000000000000000001m, 0.0000000000000000000000000001m);
        const string expected = "79228162514264337593543950335.0000000000000000000000000001";
        Assert.Equal(expected, (await service.AccountAsync(account.Id, default)).BalanceUsd);
        Assert.Equal(expected, (await service.PortfolioAsync(portfolio.Id, default)).BalanceUsd);
        Assert.Equal(expected, (await service.OverviewAsync(default)).Totals.TotalBalanceUsd);
    }

    [Fact]
    public async Task Unknown_and_empty_observed_wallets_are_distinct_and_manual_value_is_not_available_funds()
    {
        Assert.Null((await service.OverviewAsync(default)).Totals.AvailableBalanceUsd);
        Add(null, "hyperliquid", 100m, 70m, "unifiedAccount");
        Add(null, "manual", 0m);
        var unknown = (await service.OverviewAsync(default)).Totals;
        Assert.Equal("0", unknown.TotalBalanceUsd);
        Assert.Equal(1, unknown.BalanceAccountCount);
        Assert.Null(unknown.AvailableBalanceUsd);
        Assert.Equal(0, unknown.AvailableBalanceAccountCount);
        var empty = Add(null, "hyperliquid", 999m, 500m, "portfolioMargin", 0m);
        store.Snapshots.Single(s => s.AccountId == empty.Id).Stablecoins.Clear();
        var observed = (await service.OverviewAsync(default)).Totals;
        Assert.Equal("0", observed.AvailableBalanceUsd);
        Assert.Equal(1, observed.AvailableBalanceAccountCount);
        Assert.Equal("partial", observed.AvailableBalanceCoverage);
    }

    [Fact]
    public async Task Non_wallet_withdrawal_can_be_negative_and_coverage_follows_enabled_accounts()
    {
        Add(null, "public-perps", 20m, -2.0000000000000000000000000001m);
        var totals = (await service.OverviewAsync(default)).Totals;
        Assert.Equal("-2.0000000000000000000000000001", totals.AvailableBalanceUsd);
        Assert.Equal("complete", totals.AvailableBalanceCoverage);
        Assert.Equal("complete", totals.BalanceCoverage);
    }

    [Fact]
    public async Task Overview_is_uncompressed_no_store_and_rereads_after_a_settings_change()
    {
        var portfolio = await service.CreatePortfolioAsync(new("Live grouping"), default);
        var account = Add(portfolio.Id, "hyperliquid", 0m, 0m, "unifiedAccount", 750m, 600m);
        await using var factory = new CoreApiFactory(owner, store);
        using var client = factory.AuthorizedClient();
        client.DefaultRequestHeaders.AcceptEncoding.ParseAdd("gzip, br");
        using var first = await client.GetAsync("/api/overview");
        Assert.Equal("no-store", first.Headers.CacheControl?.ToString());
        Assert.Empty(first.Content.Headers.ContentEncoding);
        var before = (await first.Content.ReadFromJsonAsync<OverviewDto>())!;
        Assert.Equal("750", before.Totals.TotalBalanceUsd);
        Assert.Equal("600", before.Totals.AvailableBalanceUsd);
        using var changed = await client.PutAsJsonAsync($"/api/accounts/{account.Id}",
            new UpdateAccountRequest(account.Name, null, false, account.SettingsRevision));
        changed.EnsureSuccessStatusCode();
        var after = (await client.GetFromJsonAsync<OverviewDto>("/api/overview"))!;
        Assert.Null(after.Totals.TotalBalanceUsd);
        Assert.Null(after.Totals.AvailableBalanceUsd);
        Assert.Equal(0, after.Portfolios.Single().AccountCount);
        Assert.Null(after.Portfolios.Single().BalanceUsd);
    }
}
