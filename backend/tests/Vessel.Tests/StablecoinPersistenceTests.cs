using Microsoft.EntityFrameworkCore;
using Vessel.Application.Workspace;
using Vessel.Application.Venues;

namespace Vessel.Tests;

public sealed class StablecoinPersistenceTests
{
    [Theory]
    [InlineData("0.0000000000000000000000000001", "1", "1.0000000000000000000000000001")]
    [InlineData("79228162514264337593543950335", "1", "79228162514264337593543950336")]
    [InlineData("1.5000", "2.50", "4")]
    public void Nominal_totals_do_not_round_or_overflow_exact_token_strings(string first, string second, string expected) =>
        Assert.Equal(expected, StablecoinTotals.Sum([
            decimal.Parse(first, System.Globalization.CultureInfo.InvariantCulture),
            decimal.Parse(second, System.Globalization.CultureInfo.InvariantCulture)]));

    [Fact]
    public void Observed_empty_wallet_is_exact_zero() => Assert.Equal("0", StablecoinTotals.Sum([]));

    [PostgresFact]
    public async Task Wallet_roundtrips_without_overwriting_perp_equity_and_survives_disable_enable()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var store = new Vessel.Persistence.WorkspaceStore(db);
        var reader = new FixtureReader();
        reader.Result = reader.Result with
        {
            Snapshot = reader.Result.Snapshot with
            {
                StablecoinWallet = new(DateTimeOffset.UtcNow, "unifiedAccount", "hypercore-spot-stablecoins", [
                    new("USDC", 0, "0x6d1e7cde53ba9467b783cb7c530ce054", 12.00000000000000000000000001m, 2m, 10.00000000000000000000000001m),
                    new("USDH", 360, "0x54e00a5988577cb0b0c9ab0cb6ef7f4b", 4m, 0m, 4m)])
            }
        };
        var service = new WorkspaceService(store, new CoreOwner(owner), reader);
        var portfolio = await service.CreatePortfolioAsync(new("Wallet group"), default);
        var account = await service.CreateAccountAsync(new(portfolio.Id, "Wallet", "hyperliquid", "0x" + new string('1', 40)), default);
        var synced = await service.SyncAsync(account.Id, default);
        Assert.Equal("14.00000000000000000000000001", synced.AvailableStablecoinNominalUsd);
        Assert.Equal("unifiedAccount", synced.AccountMode);
        var snapshot = (await service.SnapshotAsync(account.Id, default))!;
        Assert.Equal(reader.Result.Snapshot.AccountValueUsd.ToString(System.Globalization.CultureInfo.InvariantCulture), snapshot.AccountValueUsd);
        Assert.Equal("16.00000000000000000000000001", snapshot.StablecoinWallet!.TotalNominalUsd);
        Assert.Equal(2, snapshot.StablecoinWallet.Balances.Count);
        Assert.Equal("14.00000000000000000000000001", (await service.OverviewAsync(default)).Totals.AvailableStablecoinNominalUsd);
        Assert.Equal(1, (await service.OverviewAsync(default)).Totals.StablecoinAccountCount);
        await service.UpdateAccountAsync(account.Id, new("Wallet", null, false), default);
        Assert.Null(await service.SnapshotAsync(account.Id, default));
        Assert.Null((await service.OverviewAsync(default)).Totals.AvailableStablecoinNominalUsd);
        Assert.Equal(2, await db.Stablecoins.CountAsync());
        await service.UpdateAccountAsync(account.Id, new("Wallet", null, true), default);
        Assert.Equal("14.00000000000000000000000001", (await service.AccountAsync(account.Id, default)).AvailableStablecoinNominalUsd);
        reader.Fail = true;
        await Assert.ThrowsAsync<WorkspaceException>(() => service.SyncAsync(account.Id, default));
        Assert.Equal("14.00000000000000000000000001", (await service.SnapshotAsync(account.Id, default))!.StablecoinWallet!.AvailableNominalUsd);
        await service.DeleteAccountAsync(account.Id, default);
        Assert.Empty(await db.Stablecoins.ToListAsync());
    }

    [PostgresFact]
    public async Task Replacement_can_empty_wallet_without_duplicates_and_owner_leaks()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var reader = new FixtureReader();
        reader.Result = reader.Result with { Snapshot = reader.Result.Snapshot with
        {
            StablecoinWallet = new(DateTimeOffset.UtcNow, "disabled", "hypercore-spot-stablecoins", [
                new("USDC", 0, "known-token", 10m, 1m, 9m)])
        } };
        var service = new WorkspaceService(new Vessel.Persistence.WorkspaceStore(db), new CoreOwner(owner), reader);
        var account = await service.CreateAccountAsync(new(null, "Wallet", "hyperliquid", "0x" + new string('2', 40)), default);
        await service.SyncAsync(account.Id, default);
        await service.SyncAsync(account.Id, default);
        Assert.Single(await db.Stablecoins.ToListAsync());
        await using (var foreign = database.Context(Guid.NewGuid()))
        {
            Assert.Empty(await foreign.Stablecoins.ToListAsync());
            var foreignService = new WorkspaceService(new Vessel.Persistence.WorkspaceStore(foreign), new CoreOwner(foreign.CurrentOwnerId), reader);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => foreignService.SnapshotAsync(account.Id, default))).StatusCode);
        }
        reader.Result = reader.Result with { Snapshot = reader.Result.Snapshot with
        {
            StablecoinWallet = new(DateTimeOffset.UtcNow, "unifiedAccount", "hypercore-spot-stablecoins", [])
        } };
        await service.SyncAsync(account.Id, default);
        Assert.Equal("0", (await service.AccountAsync(account.Id, default)).AvailableStablecoinNominalUsd);
        Assert.Empty(await db.Stablecoins.ToListAsync());
    }

    [PostgresFact]
    public async Task Existing_snapshot_has_unknown_wallet_until_refreshed()
    {
        await using var database = await CoreDatabase.CreateAsync("20261001112809_AccountManagement");
        var owner = Guid.NewGuid();
        await using (var old = database.Context(owner)) await old.Database.MigrateAsync();
        await using var db = database.Context(owner);
        var reader = new FixtureReader();
        var service = new WorkspaceService(new Vessel.Persistence.WorkspaceStore(db), new CoreOwner(owner), reader);
        var account = await service.CreateAccountAsync(new(null, "Legacy reader", "hyperliquid", "0x" + new string('3', 40)), default);
        await service.SyncAsync(account.Id, default);
        Assert.Null((await service.AccountAsync(account.Id, default)).AvailableStablecoinNominalUsd);
        Assert.Null((await service.SnapshotAsync(account.Id, default))!.StablecoinWallet);
    }
}
