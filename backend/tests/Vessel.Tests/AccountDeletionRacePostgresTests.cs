using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Vessel.Application.Common;
using Vessel.Application.Plays;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Persistence;
using Vessel.Persistence.Events;

namespace Vessel.Tests;

/// <summary>
/// Writes that reference an account a concurrent deletion removes. Each holds the account until it commits, so the
/// deletion either waits and sees the new rows, or wins and the write finds no account.
/// </summary>
public sealed class AccountDeletionRacePostgresTests
{
    private static PlayService Service(VesselDbContext db) =>
        new(new PlayStore(db, TestUnitOfWork.For(db)), new MemoryObjectStore(), new ManualTime(DateTimeOffset.UnixEpoch), TestUnitOfWork.For(db));

    [PostgresFact]
    public async Task Creating_a_play_while_its_account_is_deleted_waits_and_returns_not_found()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var account = await SeedAccount(database, owner);
        await using var deleting = database.Context(owner);
        await using var creating = database.Context(owner);
        await creating.Database.OpenConnectionAsync();
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var workspace = new WorkspaceStore(deleting, TestUnitOfWork.For(deleting));
        // The deletion has removed the account but not committed when the creation starts.
        var deletion = TestUnitOfWork.For(deleting).ExecuteAsync(() => workspace.WithManagementLockAsync(() => workspace.WithAccountLockAsync(account, async current =>
        {
            await workspace.DeleteAccountAsync(current, default);
            reached.TrySetResult();
            await release.Task.WaitAsync(TimeSpan.FromSeconds(10));
            return true;
        }, default), default), default);
        Task<PlayDto>? creation = null;
        try
        {
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            creation = Service(creating).CreateAsync(new(account, "BTC", "manual", "Racing", TestPlays.Plan()), default);
            await WaitForLock(database, creating);
        }
        finally { release.TrySetResult(); }
        await deletion.WaitAsync(TimeSpan.FromSeconds(10));
        var error = await Assert.ThrowsAsync<ProblemException>(() => creation!.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Equal(404, error.StatusCode);
        await using var db = database.Context(owner);
        Assert.Empty(await db.Plays.ToListAsync());
    }

    [PostgresFact]
    public async Task Deleting_an_account_while_a_play_is_created_on_it_waits_and_is_refused()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var account = await SeedAccount(database, owner);
        var gate = new BeforePlayInsert();
        await using var creating = new VesselDbContext(new DbContextOptionsBuilder<VesselDbContext>()
            .UseNpgsql(database.ConnectionString).AddInterceptors(gate).Options, new CoreOwner(owner));
        await using var deleting = database.Context(owner);
        await deleting.Database.OpenConnectionAsync();
        var creation = Service(creating).CreateAsync(new(account, "BTC", "manual", "Racing", TestPlays.Plan()), default);
        Task<bool>? deletion = null;
        try
        {
            // The creation holds the account and is about to insert its Play.
            await gate.Reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var workspace = new WorkspaceStore(deleting, TestUnitOfWork.For(deleting));
            deletion = TestUnitOfWork.For(deleting).ExecuteAsync(() => workspace.WithManagementLockAsync(() => workspace.WithAccountLockAsync(account, async current =>
            {
                await workspace.DeleteAccountAsync(current, default);
                return true;
            }, default), default), default);
            await Task.WhenAny(deletion, WaitForLock(database, deleting)).WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally { gate.Release.TrySetResult(); }
        var play = await creation.WaitAsync(TimeSpan.FromSeconds(10));
        var error = await Assert.ThrowsAsync<ProblemException>(() => deletion!.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Equal(409, error.StatusCode);
        await using var db = database.Context(owner);
        Assert.Equal(play.Summary.Id, Assert.Single(await db.Plays.ToListAsync()).Id);
        Assert.Single(await db.Accounts.ToListAsync());
    }

    private static async Task<Guid> SeedAccount(CoreDatabase database, Guid owner)
    {
        await using var db = database.Context(owner);
        var account = new Account(Guid.NewGuid(), owner, "manual", "Racing");
        db.Accounts.Add(account);
        await db.SaveChangesAsync();
        return account.Id;
    }

    [PostgresFact]
    public async Task A_monitoring_baseline_never_outlives_an_account_deleted_meanwhile()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var venueAccount = new Account(Guid.NewGuid(), owner, "hyperliquid", "Refresh without Plays");
        venueAccount.Configure(null, "0x" + new string('1', 40), null);
        var account = venueAccount.Id;
        await using var baselineDb = database.Context(owner);
        baselineDb.Accounts.Add(venueAccount);
        baselineDb.Fills.Add(new ImportedFill
        {
            Id = Guid.NewGuid(), OwnerId = owner, AccountId = account, ContractId = "BTC",
            SourceFillId = "deleted-fill", ExternalOrderId = "order", Side = "buy", Direction = "Open Long",
            PositionEffect = "open", Price = 100, Quantity = 1, Fee = 0, FeeToken = "USDC",
            OccurredAtUtc = DateTimeOffset.UtcNow, TransactionHash = "synthetic"
        });
        await baselineDb.SaveChangesAsync();
        // The baseline SQL does not use the outbox.
        var events = new VesselEventStore(baselineDb, new(), null!, Options.Create(new VesselEventSettings()),
            NullLogger<VesselEventStore>.Instance);
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        // A Refresh on an account without Plays writes its baseline in a unit of its own; it is held open here.
        var baseline = TestUnitOfWork.For(baselineDb).ExecuteAsync(async () =>
        {
            await events.EnsureMonitoringBaselineAsync(account, default);
            reached.SetResult();
            await release.Task.WaitAsync(TimeSpan.FromSeconds(10));
            return true;
        }, default);
        await using var deleting = database.Context(owner);
        await deleting.Database.OpenConnectionAsync();
        var workspace = new WorkspaceStore(deleting, TestUnitOfWork.For(deleting));
        Task<bool>? deletion = null;
        try
        {
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            deletion = TestUnitOfWork.For(deleting).ExecuteAsync(() => workspace.WithManagementLockAsync(
                () => workspace.WithAccountLockAsync(account, async current =>
                {
                    await workspace.DeleteAccountAsync(current, default);
                    return true;
                }, default), default), default);
            await Task.WhenAny(deletion, WaitForLock(database, deleting)).WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally { release.TrySetResult(); }
        await baseline.WaitAsync(TimeSpan.FromSeconds(10));
        await deletion!.WaitAsync(TimeSpan.FromSeconds(10));
        await using var check = database.Context(owner);
        Assert.Empty(await check.Accounts.ToListAsync());
        Assert.Empty(await check.Fills.ToListAsync());
        await using var inspect = new NpgsqlConnection(database.ConnectionString);
        await inspect.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT (SELECT count(*) FROM event_baselines) + (SELECT count(*) FROM event_fills)", inspect);
        Assert.Equal(0L, (long)(await command.ExecuteScalarAsync())!);
    }

    [PostgresFact]
    public async Task A_monitoring_baseline_after_its_account_is_deleted_finds_no_account()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var account = await SeedAccount(database, owner);
        await using var deleting = database.Context(owner);
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var workspace = new WorkspaceStore(deleting, TestUnitOfWork.For(deleting));
        var deletion = TestUnitOfWork.For(deleting).ExecuteAsync(() => workspace.WithManagementLockAsync(() => workspace.WithAccountLockAsync(account, async current =>
        {
            await workspace.DeleteAccountAsync(current, default);
            reached.TrySetResult();
            await release.Task.WaitAsync(TimeSpan.FromSeconds(10));
            return true;
        }, default), default), default);
        await using var baselineDb = database.Context(owner);
        await baselineDb.Database.OpenConnectionAsync();
        var events = new VesselEventStore(baselineDb, new(), null!, Options.Create(new VesselEventSettings()),
            NullLogger<VesselEventStore>.Instance);
        Task<bool>? baseline = null;
        try
        {
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            baseline = TestUnitOfWork.For(baselineDb).ExecuteAsync(async () =>
            {
                await events.EnsureMonitoringBaselineAsync(account, default);
                return true;
            }, default);
            await WaitForLock(database, baselineDb);
        }
        finally { release.TrySetResult(); }
        await deletion.WaitAsync(TimeSpan.FromSeconds(10));
        var error = await Assert.ThrowsAsync<ProblemException>(() => baseline!.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Equal(404, error.StatusCode);
    }

    private static async Task<string> WaitForLock(CoreDatabase database, VesselDbContext waiting)
    {
        var pid = ((NpgsqlConnection)waiting.Database.GetDbConnection()).ProcessID;
        await using var inspect = new NpgsqlConnection(database.ConnectionString);
        await inspect.OpenAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (true)
        {
            await using var command = new NpgsqlCommand(
                "SELECT wait_event FROM pg_stat_activity WHERE pid = @pid AND wait_event_type = 'Lock'", inspect);
            command.Parameters.AddWithValue("pid", pid);
            if (await command.ExecuteScalarAsync(timeout.Token) is string waitEvent) return waitEvent;
            await Task.Delay(10, timeout.Token);
        }
    }

    // Gate a creation after its account lock, immediately before the Play insert.
    private sealed class BeforePlayInsert : SaveChangesInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Reached.TrySetResult();
            await Release.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            return result;
        }
    }
}
