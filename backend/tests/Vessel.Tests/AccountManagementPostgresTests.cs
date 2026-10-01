using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Persistence;

namespace Vessel.Tests;

public sealed class AccountManagementPostgresTests
{
    private static WorkspaceService Service(VesselDbContext db, Guid owner, IPerpetualVenueReader? reader = null) =>
        new(new WorkspaceStore(db), new CoreOwner(owner), reader ?? new FixtureReader());

    private static async Task<AccountDto> VenueAccount(WorkspaceService service, Guid? portfolio = null) =>
        await service.CreateAccountAsync(new(portfolio, "Venue", "hyperliquid", "0x1111111111111111111111111111111111111111"), default);

    [PostgresFact]
    public async Task Migration_defaults_existing_records_to_enabled_and_preserves_core_data()
    {
        await using var database = await CoreDatabase.CreateAsync("20261001071844_CoreAccountPortfolio");
        var owner = Guid.NewGuid(); var id = Guid.NewGuid(); await using var db = database.Context(owner);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO accounts (\"Id\", \"OwnerId\", \"VenueId\", \"Name\", \"SyncStatus\", \"ManualAccountValueUsd\") VALUES ({id}, {owner}, 'manual', 'Existing', 'manual', 1.000000000000000000000000001)");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO account_snapshots (\"OwnerId\", \"AccountId\", \"ObservedAtUtc\", \"ValueScope\", \"AccountValueUsd\") VALUES ({owner}, {id}, now(), 'partial', NULL)");
        await db.Database.MigrateAsync();
        var account = await db.Accounts.SingleAsync(); Assert.True(account.IsEnabled); Assert.Null(account.PortfolioId);
        Assert.Equal(1.000000000000000000000000001m, account.ManualAccountValueUsd);
        Assert.Null((await db.Snapshots.SingleAsync()).AccountValueUsd); Assert.False(db.Database.HasPendingModelChanges());
        Assert.Equal(3, (await db.Database.GetAppliedMigrationsAsync()).Count());
    }

    [PostgresFact]
    public async Task Disable_hides_all_facts_before_limit_and_reenable_restores_them()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); var reader = new FixtureReader();
        var example = reader.Result.Fills.Single();
        reader.Result = reader.Result with { Fills = Enumerable.Range(0, 125).Select(i => example with { SourceFillId = i.ToString(), OccurredAtUtc = example.OccurredAtUtc.AddSeconds(i) }).ToList() };
        Guid portfolioId; Guid id; Guid other;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner, reader); portfolioId = (await service.CreatePortfolioAsync(new("Values"), default)).Id;
            id = (await VenueAccount(service, portfolioId)).Id; await service.SyncAsync(id, default);
            other = (await VenueAccount(service, portfolioId)).Id;
            var older = new FixtureReader(); older.Result = older.Result with { Fills = [example with { SourceFillId = "older", OccurredAtUtc = example.OccurredAtUtc.AddDays(-1) }] };
            await Service(db, owner, older).SyncAsync(other, default);
        }
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner, reader); var disabled = await service.UpdateAccountAsync(id, new("Disabled", portfolioId, false), default);
            Assert.False(disabled.IsEnabled); Assert.Equal(0, disabled.PositionCount);
            Assert.Null(await service.SnapshotAsync(id, default)); Assert.Empty(await service.FillsAsync(id, default));
            Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.SyncAsync(id, default))).StatusCode);
            var overview = await service.OverviewAsync(default);
            Assert.Equal(2, overview.Totals.AccountCount); Assert.Equal(2, overview.Portfolios.Single().AccountCount);
            Assert.Equal(1, overview.Totals.ValuedAccountCount); Assert.Equal(1, overview.Totals.OpenPositionCount); Assert.Equal(1, overview.Totals.ImportedFillCount);
            Assert.Equal("complete", overview.Portfolios.Single().ValueCoverage); Assert.Equal("1234.1234567890123456789012345", overview.Totals.TotalAccountValueUsd);
            Assert.Equal("older", overview.RecentActivity.Single().SourceFillId);
            Assert.Equal(126, await db.Fills.CountAsync()); Assert.Equal(2, await db.Snapshots.CountAsync()); Assert.Equal(2, await db.Positions.CountAsync());
        }
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); var enabled = await service.UpdateAccountAsync(id, new("Enabled", portfolioId, true), default);
            Assert.True(enabled.IsEnabled); Assert.Equal(1, enabled.PositionCount); Assert.NotNull(await service.SnapshotAsync(id, default)); Assert.Equal(100, (await service.FillsAsync(id, default)).Count);
            var overview = await service.OverviewAsync(default); Assert.Equal(126, overview.Totals.ImportedFillCount); Assert.Equal(2, overview.Totals.OpenPositionCount);
            Assert.Equal("2468.246913578024691357802469", overview.Totals.TotalAccountValueUsd);
        }
    }

    [PostgresFact]
    public async Task Delete_portfolio_unlinks_enabled_and_disabled_accounts_without_losing_facts_or_plays()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid first; Guid second; Guid portfolioId;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); portfolioId = (await service.CreatePortfolioAsync(new("Original"), default)).Id;
            first = (await VenueAccount(service, portfolioId)).Id; second = (await VenueAccount(service, portfolioId)).Id;
            await service.SyncAsync(first, default); await service.SyncAsync(second, default);
            var account = await db.Accounts.SingleAsync(a => a.Id == first);
            db.Plays.AddRange(new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC")), new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC")));
            await db.SaveChangesAsync(); await service.UpdateAccountAsync(second, new("Disabled", portfolioId, false), default);
            await service.RenamePortfolioAsync(portfolioId, new("Renamed"), default); await service.DeletePortfolioAsync(portfolioId, default);
        }
        await using (var db = database.Context(owner))
        {
            Assert.Empty(await db.Portfolios.ToListAsync()); Assert.Equal(2, await db.Accounts.CountAsync()); Assert.All(await db.Accounts.ToListAsync(), a => Assert.Null(a.PortfolioId));
            Assert.False((await db.Accounts.SingleAsync(a => a.Id == second)).IsEnabled); Assert.True((await db.Accounts.SingleAsync(a => a.Id == first)).IsEnabled);
            Assert.Equal(2, await db.Snapshots.CountAsync()); Assert.Equal(2, await db.Positions.CountAsync()); Assert.Equal(2, await db.Fills.CountAsync()); Assert.Equal(2, await db.Plays.CountAsync());
            await Service(db, owner).UpdateAccountAsync(second, new("Reenabled", null, true), default);
            Assert.Equal(2, (await Service(db, owner).OverviewAsync(default)).Totals.ImportedFillCount);
        }
    }

    [PostgresFact]
    public async Task Account_move_unlink_and_delete_are_owner_scoped_and_preserve_other_records()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); var foreign = Guid.NewGuid(); Guid id; Guid other; Guid foreignId; Guid foreignPortfolio;
        await using (var db = database.Context(foreign))
        {
            var service = Service(db, foreign); foreignPortfolio = (await service.CreatePortfolioAsync(new("Foreign"), default)).Id;
            foreignId = (await VenueAccount(service, foreignPortfolio)).Id; await service.SyncAsync(foreignId, default);
        }
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); var first = await service.CreatePortfolioAsync(new("First"), default); var second = await service.CreatePortfolioAsync(new("Second"), default);
            id = (await VenueAccount(service, first.Id)).Id; other = (await VenueAccount(service)).Id; await service.SyncAsync(id, default); await service.SyncAsync(other, default);
            var moved = await service.UpdateAccountAsync(id, new("Moved", second.Id, true), default); Assert.Equal(second.Id, moved.PortfolioId); Assert.Equal("hyperliquid", moved.VenueId);
            Assert.Equal("0x1111111111111111111111111111111111111111", moved.Address); Assert.Equal(1, moved.PositionCount);
            await service.UpdateAccountAsync(id, new("Unlinked", null, false), default);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.UpdateAccountAsync(other, new("Foreign", foreignPortfolio, false), default))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.UpdateAccountAsync(foreignId, new("Foreign", null, false), default))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.RenamePortfolioAsync(foreignPortfolio, new("Foreign"), default))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.DeletePortfolioAsync(foreignPortfolio, default))).StatusCode);
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.DeleteAccountAsync(foreignId, default))).StatusCode);
            await service.DeleteAccountAsync(id, default);
        }
        await using (var db = database.Context(owner))
        {
            Assert.Equal(other, (await db.Accounts.SingleAsync()).Id); Assert.Single(await db.Snapshots.ToListAsync()); Assert.Single(await db.Positions.ToListAsync()); Assert.Single(await db.Fills.ToListAsync());
            Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => Service(db, owner).AccountAsync(id, default))).StatusCode);
        }
        await using (var db = database.Context(foreign))
        {
            Assert.True((await db.Accounts.SingleAsync()).IsEnabled); Assert.Single(await db.Snapshots.ToListAsync()); Assert.Single(await db.Fills.ToListAsync());
            Assert.Equal("Foreign", (await db.Portfolios.SingleAsync()).Name);
        }
    }

    [PostgresFact]
    public async Task Real_API_linked_play_delete_is_safe_409_and_unlinked_delete_cascades()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid protectedId; Guid disposable;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); protectedId = (await VenueAccount(service)).Id; disposable = (await VenueAccount(service)).Id;
            await service.SyncAsync(protectedId, default); await service.SyncAsync(disposable, default);
            var account = await db.Accounts.SingleAsync(a => a.Id == protectedId);
            var play = new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC")); play.Close(); db.Plays.Add(play);
            db.Plays.Add(new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC")));
            await db.SaveChangesAsync();
        }
        await using var factory = new CoreApiFactory(owner, connection: database.ConnectionString); using var client = factory.AuthorizedClient();
        var blocked = await client.DeleteAsync($"/api/accounts/{protectedId}"); Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Equal("application/problem+json", blocked.Content.Headers.ContentType?.MediaType); var error = await blocked.Content.ReadAsStringAsync(); Assert.DoesNotContain("Exception", error); Assert.DoesNotContain("FK_", error);
        var disabled = await client.PutAsJsonAsync($"/api/accounts/{protectedId}", new UpdateAccountRequest("Disabled", null, false)); Assert.Equal(HttpStatusCode.OK, disabled.StatusCode);
        Assert.Equal("null", await client.GetStringAsync($"/api/accounts/{protectedId}/snapshot")); Assert.Equal("[]", await client.GetStringAsync($"/api/accounts/{protectedId}/fills"));
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/accounts/{protectedId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/accounts/{disposable}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/accounts/{disposable}")).StatusCode);
        await using var verify = database.Context(owner);
        Assert.Equal(protectedId, (await verify.Accounts.SingleAsync()).Id); Assert.Single(await verify.Snapshots.ToListAsync()); Assert.Single(await verify.Positions.ToListAsync()); Assert.Single(await verify.Fills.ToListAsync());
        Assert.Equal(2, await verify.Plays.CountAsync()); Assert.Contains(await verify.Plays.ToListAsync(), p => p.Status == PlayStatus.Closed); Assert.Contains(await verify.Plays.ToListAsync(), p => p.Status == PlayStatus.Active);
        var reenabled = await client.PutAsJsonAsync($"/api/accounts/{protectedId}", new UpdateAccountRequest("Enabled", null, true)); Assert.Equal(HttpStatusCode.OK, reenabled.StatusCode);
        Assert.NotNull(await client.GetFromJsonAsync<SnapshotDto>($"/api/accounts/{protectedId}/snapshot")); Assert.Single((await client.GetFromJsonAsync<FillDto[]>($"/api/accounts/{protectedId}/fills"))!);
    }

    [PostgresFact]
    public async Task Disable_waits_for_inflight_sync_then_prevents_any_late_refresh()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid id;
        await using (var db = database.Context(owner)) id = (await VenueAccount(Service(db, owner))).Id;
        var reader = new GatedReader(); await using var syncing = database.Context(owner); await using var changing = database.Context(owner);
        await changing.Database.OpenConnectionAsync(); var pid = ((NpgsqlConnection)changing.Database.GetDbConnection()).ProcessID;
        var sync = Service(syncing, owner, reader).SyncAsync(id, default); await reader.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var disable = Service(changing, owner).UpdateAccountAsync(id, new("Disabled", null, false), default);
        try { await WaitForLock(database, pid); Assert.False(disable.IsCompleted); }
        finally { reader.Release.TrySetResult(); }
        await sync; Assert.False((await disable).IsEnabled);
        await using var verify = database.Context(owner); var service = Service(verify, owner, reader);
        Assert.False((await verify.Accounts.SingleAsync()).IsEnabled); Assert.Single(await verify.Snapshots.ToListAsync()); Assert.Single(await verify.Fills.ToListAsync());
        Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => service.SyncAsync(id, default))).StatusCode); Assert.Equal(1, reader.Reads);
        Assert.Null(await service.SnapshotAsync(id, default)); Assert.Empty((await service.OverviewAsync(default)).RecentActivity);
    }

    [PostgresFact]
    public async Task Delete_waits_for_inflight_sync_then_removes_all_facts_without_resurrection()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid id;
        await using (var db = database.Context(owner)) id = (await VenueAccount(Service(db, owner))).Id;
        var reader = new GatedReader(); await using var syncing = database.Context(owner); await using var deleting = database.Context(owner);
        await deleting.Database.OpenConnectionAsync(); var pid = ((NpgsqlConnection)deleting.Database.GetDbConnection()).ProcessID;
        var sync = Service(syncing, owner, reader).SyncAsync(id, default); await reader.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var delete = Service(deleting, owner).DeleteAccountAsync(id, default);
        try { await WaitForLock(database, pid); Assert.False(delete.IsCompleted); }
        finally { reader.Release.TrySetResult(); }
        // A concurrent delete can win immediately after sync commits, so its readback may be 404.
        try { await sync; } catch (WorkspaceException error) { Assert.Equal(404, error.StatusCode); }
        await delete;
        await using var verify = database.Context(owner); Assert.Empty(await verify.Accounts.ToListAsync()); Assert.Empty(await verify.Snapshots.ToListAsync()); Assert.Empty(await verify.Positions.ToListAsync()); Assert.Empty(await verify.Fills.ToListAsync());
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => Service(verify, owner, reader).SyncAsync(id, default))).StatusCode); Assert.Equal(1, reader.Reads);
    }

    [PostgresFact]
    public async Task Sync_queued_after_disable_reads_locked_settings_and_never_calls_provider()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid id;
        await using (var db = database.Context(owner)) id = (await VenueAccount(Service(db, owner))).Id;
        await using var changing = database.Context(owner); await using var syncing = database.Context(owner); var reader = new FixtureReader();
        // Preload to prove lock acquisition reloads an already tracked stale enabled record.
        Assert.True((await syncing.Accounts.SingleAsync()).IsEnabled);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var store = new WorkspaceStore(changing);
        var disable = store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            account.UpdateSettings("Disabled", null, false); await store.SaveAsync(default); entered.TrySetResult(); await release.Task; return true;
        }, default), default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await syncing.Database.OpenConnectionAsync(); var pid = ((NpgsqlConnection)syncing.Database.GetDbConnection()).ProcessID;
        var sync = Service(syncing, owner, reader).SyncAsync(id, default);
        try { await WaitForLock(database, pid); Assert.Equal(0, reader.Reads); }
        finally { release.TrySetResult(); }
        await disable; Assert.Equal(400, (await Assert.ThrowsAsync<WorkspaceException>(() => sync)).StatusCode); Assert.Equal(0, reader.Reads);
        await using var verify = database.Context(owner); Assert.Empty(await verify.Snapshots.ToListAsync()); Assert.False((await verify.Accounts.SingleAsync()).IsEnabled);
    }

    [PostgresFact]
    public async Task Sync_queued_after_hard_delete_returns_404_without_calling_provider_or_resurrecting_facts()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid id;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); id = (await VenueAccount(service)).Id; await service.SyncAsync(id, default);
        }
        await using var deleting = database.Context(owner); await using var syncing = database.Context(owner); var reader = new FixtureReader();
        Assert.NotNull(await syncing.Accounts.SingleOrDefaultAsync(a => a.Id == id));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var store = new WorkspaceStore(deleting);
        var deletion = store.WithManagementLockAsync(() => store.WithAccountLockAsync(id, async account =>
        {
            await store.DeleteAccountAsync(account, default); entered.TrySetResult(); await release.Task; return true;
        }, default), default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await syncing.Database.OpenConnectionAsync(); var pid = ((NpgsqlConnection)syncing.Database.GetDbConnection()).ProcessID;
        var sync = Service(syncing, owner, reader).SyncAsync(id, default);
        try { await WaitForLock(database, pid); Assert.Equal(0, reader.Reads); }
        finally { release.TrySetResult(); }
        await deletion; Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => sync)).StatusCode); Assert.Equal(0, reader.Reads);
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync()); Assert.Empty(await verify.Snapshots.ToListAsync()); Assert.Empty(await verify.Fills.ToListAsync()); Assert.Empty(await verify.Positions.ToListAsync());
    }

    [PostgresFact]
    public async Task Concurrent_assignments_and_portfolio_delete_never_leave_dangling_membership()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid target; Guid existing;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); target = (await service.CreatePortfolioAsync(new("Delete target"), default)).Id;
            existing = (await VenueAccount(service)).Id;
        }
        var operations = Enumerable.Range(0, 12).Select(async i =>
        {
            await using var db = database.Context(owner); var service = Service(db, owner);
            try
            {
                if (i % 2 == 0) await VenueAccount(service, target);
                else await service.UpdateAccountAsync(existing, new("Moved", target, i % 3 == 0), default);
            }
            catch (WorkspaceException error) { Assert.Equal(404, error.StatusCode); }
        }).ToList();
        operations.Add(Task.Run(async () => { await using var db = database.Context(owner); await Service(db, owner).DeletePortfolioAsync(target, default); }));
        await Task.WhenAll(operations).WaitAsync(TimeSpan.FromSeconds(20));
        await using var verify = database.Context(owner); Assert.Empty(await verify.Portfolios.ToListAsync()); Assert.All(await verify.Accounts.ToListAsync(), a => Assert.Null(a.PortfolioId));
        Assert.NotNull(await verify.Accounts.SingleOrDefaultAsync(a => a.Id == existing));
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => Service(verify, owner).CreateAccountAsync(new(target, "Missing", "manual"), default))).StatusCode);
    }

    [PostgresFact]
    public async Task Portfolio_delete_waits_for_sync_and_retains_finished_snapshot_when_unlinking()
    {
        await using var database = await CoreDatabase.CreateAsync(); var owner = Guid.NewGuid(); Guid id; Guid portfolio;
        await using (var db = database.Context(owner))
        {
            var service = Service(db, owner); portfolio = (await service.CreatePortfolioAsync(new("Portfolio"), default)).Id; id = (await VenueAccount(service, portfolio)).Id;
        }
        var reader = new GatedReader(); await using var syncing = database.Context(owner); await using var deleting = database.Context(owner);
        await deleting.Database.OpenConnectionAsync(); var pid = ((NpgsqlConnection)deleting.Database.GetDbConnection()).ProcessID;
        var sync = Service(syncing, owner, reader).SyncAsync(id, default); await reader.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var deletion = Service(deleting, owner).DeletePortfolioAsync(portfolio, default);
        try { await WaitForLock(database, pid); Assert.False(deletion.IsCompleted); }
        finally { reader.Release.TrySetResult(); }
        await sync; await deletion;
        await using var verify = database.Context(owner); var account = await verify.Accounts.SingleAsync(); Assert.Null(account.PortfolioId); Assert.True(account.IsEnabled); Assert.Equal("synced", account.SyncStatus);
        Assert.Single(await verify.Snapshots.ToListAsync()); Assert.Single(await verify.Positions.ToListAsync()); Assert.Single(await verify.Fills.ToListAsync());
    }

    // Observe PostgreSQL's actual wait, not a timing assumption about an unfinished task.
    private static async Task WaitForLock(CoreDatabase database, int pid)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await using var connection = new NpgsqlConnection(database.ConnectionString); await connection.OpenAsync(deadline.Token);
        while (!deadline.IsCancellationRequested)
        {
            await using var command = new NpgsqlCommand("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = @pid", connection);
            command.Parameters.AddWithValue("pid", pid);
            if (await command.ExecuteScalarAsync(deadline.Token) is true) return;
            await Task.Delay(10, deadline.Token);
        }
        throw new TimeoutException("Expected PostgreSQL lock wait was not observed.");
    }

    private sealed class GatedReader : IPerpetualVenueReader
    {
        public string VenueId => "hyperliquid";
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Reads;
        public async Task<PerpetualVenueReadResult> ReadAsync(string address, CancellationToken ct)
        {
            Interlocked.Increment(ref Reads); Entered.TrySetResult(); await Release.Task.WaitAsync(ct);
            return new FixtureReader().Result;
        }
    }
}
