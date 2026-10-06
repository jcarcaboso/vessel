using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

public sealed class AccountManagementTests
{
    [Fact]
    public void Domain_settings_preserve_source_and_sync_metadata()
    {
        var account = new Account(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Before");
        account.Configure(Guid.NewGuid(), "0x1111111111111111111111111111111111111111", null);
        var observed = DateTimeOffset.Parse("2026-10-01T10:00:00Z");
        account.RecordSync(observed, "Bounded history");
        Assert.True(account.IsEnabled);
        account.UpdateSettings("  Renamed  ", null, false);
        Assert.Equal("Renamed", account.Name); Assert.Null(account.PortfolioId); Assert.False(account.IsEnabled);
        Assert.Equal("hyperliquid", account.VenueId); Assert.Equal("0x1111111111111111111111111111111111111111", account.Address);
        Assert.Equal(observed, account.LastSyncedAtUtc); Assert.Equal("synced", account.SyncStatus); Assert.Equal("Bounded history", account.HistoryNotice);
        account.UpdateSettings("Renamed", Guid.NewGuid(), true); Assert.True(account.IsEnabled);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(null)]
    public void Domain_rejects_empty_names(string? name)
    {
        var owner = Guid.NewGuid(); var account = new Account(Guid.NewGuid(), owner, "manual", "Account");
        var portfolio = new Portfolio(Guid.NewGuid(), owner, "Portfolio");
        Assert.ThrowsAny<ArgumentException>(() => account.UpdateSettings(name!, null, false));
        Assert.ThrowsAny<ArgumentException>(() => portfolio.Rename(name!));
        Assert.True(account.IsEnabled); Assert.Equal("Account", account.Name); Assert.Equal("Portfolio", portfolio.Name);
    }

    [Fact]
    public void Domain_rejects_long_names_and_empty_portfolio_ID_without_changes()
    {
        var account = new Account(Guid.NewGuid(), Guid.NewGuid(), "manual", "Account");
        Assert.Throws<ArgumentException>(() => account.UpdateSettings(new string('x', 201), null, false));
        Assert.Throws<ArgumentException>(() => account.UpdateSettings("Name", Guid.Empty, false));
        Assert.True(account.IsEnabled); Assert.Null(account.PortfolioId);
        var portfolio = new Portfolio(Guid.NewGuid(), account.OwnerId, "Portfolio");
        Assert.Throws<ArgumentException>(() => portfolio.Rename(new string('x', 201)));
        portfolio.Rename(" Trimmed "); Assert.Equal("Trimmed", portfolio.Name);
    }

    [Fact]
    public async Task Unassigned_creation_move_unlink_and_portfolio_deletion_keep_account_records()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var service = new WorkspaceService(store, new CoreOwner(owner), TestVenues.With(new FixtureReader()));
        var account = await service.CreateAccountAsync(new(null, "Account", "manual", ManualAccountValueUsd: "12.123456789"), default);
        Assert.Null(account.PortfolioId); Assert.True(account.IsEnabled); Assert.Empty(store.Portfolios);
        var first = await service.CreatePortfolioAsync(new("First"), default); var second = await service.CreatePortfolioAsync(new("Second"), default);
        await service.UpdateAccountAsync(account.Id, new(" Renamed ", first.Id, true, 1), default);
        Assert.Equal(1, (await service.PortfolioAsync(first.Id, default)).AccountCount);
        await service.UpdateAccountAsync(account.Id, new("Renamed", second.Id, false, 2), default);
        Assert.Equal(0, (await service.PortfolioAsync(first.Id, default)).AccountCount);
        var renamed = await service.RenamePortfolioAsync(second.Id, new(" Second renamed "), default);
        Assert.Equal("Second renamed", renamed.Name); Assert.Equal(1, renamed.AccountCount); Assert.Null(renamed.TotalValueUsd);
        await service.DeletePortfolioAsync(second.Id, default);
        var after = await service.AccountAsync(account.Id, default);
        Assert.Null(after.PortfolioId); Assert.False(after.IsEnabled); Assert.Equal("Renamed", after.Name); Assert.Equal("12.123456789", after.AccountValueUsd);
        await service.UpdateAccountAsync(account.Id, new("Renamed", null, true, after.SettingsRevision), default);
        Assert.Equal("12.123456789", (await service.OverviewAsync(default)).Totals.TotalAccountValueUsd);
    }

    [Fact]
    public async Task Disabled_records_do_not_affect_coverage_counts_or_recent_activity_and_restore()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var reader = new FixtureReader();
        var service = new WorkspaceService(store, new CoreOwner(owner), TestVenues.With(reader));
        var portfolio = await service.CreatePortfolioAsync(new("Values"), default);
        await service.CreateAccountAsync(new(portfolio.Id, "Known", "manual", ManualAccountValueUsd: "10"), default);
        var unknown = await service.CreateAccountAsync(new(portfolio.Id, "Unknown", "manual"), default);
        var venue = await service.CreateAccountAsync(new(portfolio.Id, "Venue", "hyperliquid", "0x1111111111111111111111111111111111111111"), default);
        store.Snapshots.Add(new AccountSnapshot { OwnerId = owner, AccountId = venue.Id, AccountValueUsd = 20, Positions = [new() { OwnerId = owner, AccountId = venue.Id, ContractId = "BTC" }] });
        store.Fills.Add(new ImportedFill { Id = Guid.NewGuid(), OwnerId = owner, AccountId = venue.Id, ContractId = "BTC" });
        await service.UpdateAccountAsync(unknown.Id, new("Unknown", portfolio.Id, false, 1), default);
        await service.UpdateAccountAsync(venue.Id, new("Venue", portfolio.Id, false, 1), default);
        var overview = await service.OverviewAsync(default);
        Assert.Equal(3, overview.Totals.AccountCount); Assert.Equal(1, overview.Totals.ValuedAccountCount); Assert.Equal("10", overview.Totals.TotalAccountValueUsd);
        Assert.Equal(3, overview.Portfolios.Single().AccountCount); Assert.Equal("complete", overview.Portfolios.Single().ValueCoverage);
        Assert.Equal(0, overview.Totals.ImportedFillCount); Assert.Equal(0, overview.Totals.OpenPositionCount); Assert.Empty(overview.RecentActivity);
        Assert.Null(await service.SnapshotAsync(venue.Id, default)); Assert.Empty(await service.FillsAsync(venue.Id, default));
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.SyncAsync(venue.Id, default))).StatusCode); Assert.Equal(0, reader.Reads);
        Assert.Single(store.Snapshots); Assert.Single(store.Fills);
        await service.UpdateAccountAsync(venue.Id, new("Venue", portfolio.Id, true, 2), default);
        Assert.NotNull(await service.SnapshotAsync(venue.Id, default)); Assert.Single(await service.FillsAsync(venue.Id, default));
        var restored = await service.OverviewAsync(default);
        Assert.Equal("30", restored.Totals.TotalAccountValueUsd); Assert.Equal(1, restored.Totals.ImportedFillCount); Assert.Equal(1, restored.Totals.OpenPositionCount);
    }

    [Fact]
    public async Task All_disabled_values_are_unavailable_not_zero()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var service = new WorkspaceService(store, new CoreOwner(owner), TestVenues.With(new FixtureReader()));
        var portfolio = await service.CreatePortfolioAsync(new("Empty"), default);
        var account = await service.CreateAccountAsync(new(portfolio.Id, "Zero", "manual", ManualAccountValueUsd: "0"), default);
        await service.UpdateAccountAsync(account.Id, new("Zero", portfolio.Id, false, 1), default);
        var overview = await service.OverviewAsync(default);
        Assert.Null(overview.Totals.TotalAccountValueUsd); Assert.Null(overview.Portfolios.Single().TotalValueUsd);
        Assert.Equal("unavailable", overview.Portfolios.Single().ValueCoverage); Assert.Equal(1, overview.Totals.AccountCount);
    }
}
