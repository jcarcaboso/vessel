using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Ownership;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

public sealed class UnitOfWorkTests
{
    [PostgresFact]
    public async Task DI_shares_one_owner_context_and_boundary_per_scope()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var services = new ServiceCollection();
        services.AddSingleton<IJournalOwnerContext>(new CoreOwner(owner));
        services.AddVesselPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Vessel"] = database.ConnectionString
        }).Build());
        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<VesselDbContext>();
        var work = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        Assert.Same(work, scope.ServiceProvider.GetRequiredService<UnitOfWork>());
        var accounts = scope.ServiceProvider.GetRequiredService<IWorkspaceStore>();
        var plays = scope.ServiceProvider.GetRequiredService<IPlayStore>();
        var executions = scope.ServiceProvider.GetRequiredService<IPlayExecutionStore>();
        var diary = scope.ServiceProvider.GetRequiredService<IDiaryStore>();
        await work.ExecuteAsync(async () =>
        {
            var account = Account(owner);
            await accounts.AddAccountAsync(account, default);
            var play = TestPlays.Create(account, new("hyperliquid", "BTC"));
            plays.Add(play);
            executions.Add(new PlayOrderLink(play, "order", OrderLinkRole.Entry, "entry-1", null,
                OrderLinkState.Linked, OrderLinkSource.Owner, DateTimeOffset.UnixEpoch));
            diary.Add(new DiaryRequest { Id = Guid.NewGuid(), OwnerId = owner, PayloadHash = "hash", Response = "{}" });
            Assert.Same(account, await executions.AccountAsync(account.Id, default));
            Assert.Equal(4, db.ChangeTracker.Entries().Count());
            return true;
        }, default);
        await using var other = provider.CreateAsyncScope();
        Assert.NotSame(db, other.ServiceProvider.GetRequiredService<VesselDbContext>());
        Assert.NotSame(work, other.ServiceProvider.GetRequiredService<IUnitOfWork>());
        await using var verify = database.Context(owner);
        Assert.Single(await verify.Plays.ToListAsync());
        Assert.Single(await verify.OrderLinks.ToListAsync());
        Assert.Single(await verify.DiaryRequests.ToListAsync());
        await using var foreign = database.Context(Guid.NewGuid());
        Assert.Empty(await foreign.Plays.ToListAsync());
    }

    [PostgresFact]
    public async Task Nested_services_and_intermediate_saves_commit_once_and_are_not_visible_before_commit()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var transactions = new Transactions();
        await using var db = Context(database, owner, transactions);
        var work = TestUnitOfWork.For(db);
        var plays = new PlayService(new PlayStore(db, work), new MemoryObjectStore(), TimeProvider.System, work);
        var accounts = new WorkspaceService(new WorkspaceStore(db, work), new CoreOwner(owner),
            TestVenues.With(new FixtureReader()), work);
        var executions = new ExecutionStore(db, work);
        var play = await work.ExecuteAsync(async () =>
        {
            var account = await accounts.CreateAccountAsync(new(null, "Account", "hyperliquid", "0x" + new string('a', 40)), default);
            var draft = await plays.CreateAsync(new(account.Id, "BTC", "venue", "Idea", TestPlays.Plan()), default);
            await work.SaveChangesAsync(default);
            var planned = await plays.ChangeStatusAsync(draft.Summary.Id, new(draft.Summary.Version, "planned"), default);
            await executions.WithAccountLockAsync(account.Id, async () =>
            {
                await executions.UpsertOrdersAsync((await executions.AccountAsync(account.Id, default))!,
                    [new("order-1", "BTC", "buy", "Limit", 100, null, false, false, 1, 1,
                        DateTimeOffset.UnixEpoch, VenueOrderStatus.Open, "open", DateTimeOffset.UnixEpoch)],
                    DateTimeOffset.UnixEpoch, default);
                Assert.Single(await executions.OrdersAsync(account.Id, default));
                return true;
            }, default);
            await using var outside = database.Context(owner);
            Assert.Empty(await outside.Accounts.ToListAsync());
            Assert.Empty(await outside.Plays.ToListAsync());
            Assert.Empty(await outside.Orders.ToListAsync());
            Assert.Equal(0, transactions.Commits);
            return planned;
        }, default);
        Assert.Equal(1, transactions.Starts);
        Assert.Equal(1, transactions.Commits);
        Assert.Equal(0, transactions.Rollbacks);
        await using var verify = database.Context(owner);
        Assert.Equal(PlayStatus.Planned, (await verify.Plays.SingleAsync()).Status);
        Assert.Equal(play.Summary.Id, (await verify.StatusChanges.SingleAsync()).PlayId);
        Assert.Single(await verify.PlanRevisions.ToListAsync());
        Assert.Single(await verify.Orders.ToListAsync());
    }

    [PostgresFact]
    public async Task Rollback_restores_replaced_composite_keys_imported_orders_and_fills_and_clears_tracking()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var accounts = new WorkspaceStore(db, work);
        var executions = new ExecutionStore(db, work);
        var account = Account(owner);
        var first = Snapshot(1, 10);
        await work.ExecuteAsync(async () =>
        {
            await accounts.AddAccountAsync(account, default);
            await accounts.WithAccountLockAsync(account.Id, async locked =>
            {
                await accounts.SaveRefreshAsync(locked, first, default);
                return true;
            }, default);
            return true;
        }, default);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync<bool>(async () =>
        {
            await accounts.WithAccountLockAsync(account.Id, async locked =>
            {
                await accounts.SaveRefreshAsync(locked, Snapshot(2, 20), default);
                await executions.UpsertOrdersAsync(locked,
                    [new("pending", "BTC", "buy", "Limit", 100, null, false, false, 1, 1,
                        DateTimeOffset.UnixEpoch, VenueOrderStatus.Open, "open", DateTimeOffset.UnixEpoch)], DateTimeOffset.UnixEpoch, default);
                return true;
            }, default);
            Assert.Equal(2, (await db.Positions.SingleAsync()).SignedQuantity);
            Assert.Equal(20, (await db.Stablecoins.SingleAsync()).Total);
            throw new InvalidOperationException("Abort after intermediate saves.");
        }, default));
        Assert.Empty(db.ChangeTracker.Entries());
        Assert.Null(db.Database.CurrentTransaction);
        await work.ExecuteAsync(async () =>
        {
            await accounts.AddPortfolioAsync(new(Guid.NewGuid(), owner, "Later operation"), default);
            return true;
        }, default);
        await using var verify = database.Context(owner);
        Assert.Equal(1, (await verify.Positions.SingleAsync()).SignedQuantity);
        Assert.Equal(10, (await verify.Stablecoins.SingleAsync()).Total);
        Assert.Equal(first.Snapshot.ObservedAtUtc, (await verify.Snapshots.SingleAsync()).ObservedAtUtc);
        Assert.Equal(first.Snapshot.ObservedAtUtc, (await verify.Accounts.SingleAsync()).LastSyncedAtUtc);
        Assert.Equal("fill-1", (await verify.Fills.SingleAsync()).SourceFillId);
        Assert.Empty(await verify.Orders.ToListAsync());
        Assert.Single(await verify.Portfolios.ToListAsync());
    }

    [PostgresFact]
    public async Task Caught_nested_failure_poisoning_rolls_back_already_saved_changes()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var store = new WorkspaceStore(db, work);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(async () =>
        {
            try
            {
                await work.ExecuteAsync<bool>(async () =>
                {
                    await store.AddAccountAsync(Account(owner), default);
                    throw new InvalidOperationException("Nested failure.");
                }, default);
            }
            catch (InvalidOperationException) { }
            return true;
        }, default));
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Caught_lock_callback_failure_cannot_commit_partial_mutations()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var store = new WorkspaceStore(db, work);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(async () =>
        {
            try
            {
                await store.WithManagementLockAsync<bool>(async () =>
                {
                    await store.AddAccountAsync(Account(owner), default);
                    throw new InvalidOperationException("Lock callback failed.");
                }, default);
            }
            catch (InvalidOperationException) { }
            return true;
        }, default));
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [PostgresFact]
    public async Task Cancelled_intermediate_save_rolls_back_without_using_cancelled_token_for_rollback()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var transactions = new Transactions();
        await using var db = Context(database, owner, transactions);
        var work = TestUnitOfWork.For(db);
        using var cancellation = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(owner));
            await work.SaveChangesAsync(default);
            cancellation.Cancel();
            return true;
        }, cancellation.Token));
        Assert.Equal(0, transactions.Commits);
        Assert.Equal(1, transactions.Rollbacks);
        Assert.False(transactions.CancelledRollback);
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Caught_failed_save_poisoning_is_not_a_successful_no_op()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(Guid.NewGuid()));
            try { await work.SaveChangesAsync(default); }
            catch (UnauthorizedAccessException) { }
            return true;
        }, default));
        Assert.Empty(db.ChangeTracker.Entries());
        await work.ExecuteAsync(() => Task.FromResult(true), default);
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Lock_and_save_require_the_callers_boundary_and_never_adopt_an_external_transaction()
    {
        await using var database = await CoreDatabase.CreateAsync();
        await using var db = database.Context(Guid.NewGuid());
        var work = TestUnitOfWork.For(db);
        var accounts = new WorkspaceStore(db, work);
        var plays = new PlayStore(db, work);
        var executions = new ExecutionStore(db, work);
        var diary = new DiaryStore(db, work);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.SaveChangesAsync(default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => accounts.WithManagementLockAsync(() => Task.FromResult(true), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => accounts.WithAccountLockAsync(Guid.NewGuid(), _ => Task.FromResult(true), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => plays.WithPlayLockAsync(Guid.NewGuid(), () => Task.FromResult(true), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => executions.WithAccountLockAsync(Guid.NewGuid(), () => Task.FromResult(true), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => diary.WithRequestLockAsync(Guid.NewGuid(), () => Task.FromResult(true), default));
        Assert.Null(db.Database.CurrentTransaction);
        await using var external = await db.Database.BeginTransactionAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() => Task.FromResult(true), default));
        Assert.Same(external, db.Database.CurrentTransaction);
    }

    [PostgresFact]
    public async Task Concurrent_top_level_start_is_rejected_and_poisoned_root_rolls_back()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var entered = Signal();
        var release = Signal();
        var first = work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(owner));
            await work.SaveChangesAsync(default);
            entered.SetResult();
            await release.Task;
            return true;
        }, default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try { await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() => Task.FromResult(true), default)); }
        finally { release.SetResult(); }
        await Assert.ThrowsAsync<InvalidOperationException>(() => first);
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Root_inherited_parallel_callbacks_never_enter_together_and_roll_back()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(owner));
            using var start = new Barrier(2);
            var entered = Signal();
            var rejected = Signal();
            var admitted = 0;
            Task Race() => Task.Run(async () =>
            {
                Assert.True(start.SignalAndWait(TimeSpan.FromSeconds(10)));
                try
                {
                    await work.ExecuteAsync(async () =>
                    {
                        Interlocked.Increment(ref admitted);
                        entered.TrySetResult();
                        await rejected.Task.WaitAsync(TimeSpan.FromSeconds(10));
                        return true;
                    }, default);
                }
                catch (InvalidOperationException) { rejected.TrySetResult(); }
            });
            var first = Race();
            var second = Race();
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal(1, admitted);
            return true;
        }, default));
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Final_save_lease_and_late_failure_check_prevent_commit_of_a_swallowed_concurrent_failure()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var gate = new SaveGate();
        await using var db = Context(database, owner, gate);
        var work = TestUnitOfWork.For(db);
        Task? attempt = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() =>
        {
            db.Accounts.Add(Account(owner));
            attempt = Task.Run(async () =>
            {
                await gate.Entered.Task;
                try { await work.ExecuteAsync<int>(() => throw new InvalidOperationException("Late failure."), default); }
                catch (InvalidOperationException) { }
                finally { gate.Release.SetResult(); }
            });
            return Task.FromResult(true);
        }, default));
        await attempt!.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Dangling_participant_cannot_write_after_rollback_or_reuse_the_scope()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var plays = new PlayStore(db, work);
        var release = Signal();
        Task? dangling = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() =>
        {
            dangling = work.ExecuteAsync(async () =>
            {
                await release.Task;
                plays.Add(TestPlays.Create(Account(owner), new("hyperliquid", "BTC")));
                return true;
            }, default);
            return Task.FromResult(true);
        }, default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() => Task.FromResult(true), default));
        release.SetResult();
        await Assert.ThrowsAsync<InvalidOperationException>(() => dangling!.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Empty(db.ChangeTracker.Entries());
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Plays.ToListAsync());
    }

    [PostgresFact]
    public async Task Old_execution_context_cannot_join_or_poison_a_later_boundary()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var release = Signal();
        Task? old = null;
        await work.ExecuteAsync(() =>
        {
            old = Task.Run(async () =>
            {
                await release.Task;
                await work.ExecuteAsync(() => Task.FromResult(true), default);
            });
            return Task.FromResult(true);
        }, default);
        await work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(owner));
            release.SetResult();
            await Assert.ThrowsAsync<InvalidOperationException>(() => old!.WaitAsync(TimeSpan.FromSeconds(10)));
            return true;
        }, default);
        await using var verify = database.Context(owner);
        Assert.Single(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Completed_nested_context_cannot_reenter_while_a_sibling_is_running()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        await using var db = database.Context(owner);
        var work = TestUnitOfWork.For(db);
        var release = Signal();
        Task? stale = null;
        var entered = false;
        await work.ExecuteAsync(async () =>
        {
            db.Accounts.Add(Account(owner));
            await work.ExecuteAsync(() =>
            {
                stale = Task.Run(async () =>
                {
                    await release.Task;
                    await work.ExecuteAsync(() =>
                    {
                        entered = true;
                        return Task.FromResult(true);
                    }, default);
                });
                return Task.FromResult(true);
            }, default);
            await work.ExecuteAsync(async () =>
            {
                release.SetResult();
                await Assert.ThrowsAsync<InvalidOperationException>(
                    () => stale!.WaitAsync(TimeSpan.FromSeconds(10)));
                Assert.False(entered);
                return true;
            }, default);
            return true;
        }, default);
        await using var verify = database.Context(owner);
        Assert.Single(await verify.Accounts.ToListAsync());
    }

    [PostgresFact]
    public async Task Rollback_closes_admission_before_awaiting_the_database()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var gate = new RollbackGate();
        await using var db = Context(database, owner, gate);
        var work = TestUnitOfWork.For(db);
        Task? stale = null;
        var admitted = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync<bool>(() =>
        {
            stale = Task.Run(async () =>
            {
                await gate.Entered.Task;
                try
                {
                    await Assert.ThrowsAsync<InvalidOperationException>(() => work.ExecuteAsync(() =>
                    {
                        admitted = true;
                        db.Accounts.Add(Account(owner));
                        return Task.FromResult(true);
                    }, default));
                }
                finally { gate.Release.TrySetResult(); }
            });
            throw new InvalidOperationException("Deliberate application failure.");
        }, default));
        await stale!.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.False(admitted);
        Assert.Empty(db.ChangeTracker.Entries());
        await work.ExecuteAsync(() => Task.FromResult(true), default);
        await using var verify = database.Context(owner);
        Assert.Empty(await verify.Accounts.ToListAsync());
    }

    private static Account Account(Guid owner)
    {
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Account");
        account.Configure(null, "0x" + new string('a', 40), null);
        return account;
    }

    private static PerpetualVenueReadResult Snapshot(int quantity, int balance)
    {
        var time = DateTimeOffset.UnixEpoch.AddDays(quantity);
        return new(new(time, "primary-perpetual-dex", balance, balance, 1,
            [new("BTC", quantity, 100, 0, 1, 3)], new(time, "default", "stablecoins",
                [new("USDC", 0, "token", balance, 0, balance)])), [],
            [new("fill-" + quantity, "BTC", "buy", "Open Long", 100, quantity, 0, "USDC", 0, time, "order-" + quantity, "", "", "open")],
            "Bounded history.");
    }

    private static TaskCompletionSource Signal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static VesselDbContext Context(CoreDatabase database, Guid owner, IInterceptor interceptor) =>
        new(new DbContextOptionsBuilder<VesselDbContext>().UseNpgsql(database.ConnectionString)
            .AddInterceptors(interceptor).Options, new CoreOwner(owner));

    private sealed class SaveGate : SaveChangesInterceptor
    {
        public TaskCompletionSource Entered { get; } = Signal();
        public TaskCompletionSource Release { get; } = Signal();
        public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            return result;
        }
    }

    private sealed class RollbackGate : DbTransactionInterceptor
    {
        public TaskCompletionSource Entered { get; } = Signal();
        public TaskCompletionSource Release { get; } = Signal();
        public override async ValueTask<InterceptionResult> TransactionRollingBackAsync(
            DbTransaction transaction, TransactionEventData eventData, InterceptionResult result,
            CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            return result;
        }
    }

    private sealed class Transactions : DbTransactionInterceptor
    {
        public int Starts, Commits, Rollbacks;
        public bool CancelledRollback;
        public override ValueTask<DbTransaction> TransactionStartedAsync(DbConnection connection, TransactionEndEventData eventData,
            DbTransaction result, CancellationToken cancellationToken = default)
        {
            Starts++;
            return ValueTask.FromResult(result);
        }
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            Commits++;
            return Task.CompletedTask;
        }
        public override Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            Rollbacks++;
            CancelledRollback |= cancellationToken.IsCancellationRequested;
            return Task.CompletedTask;
        }
    }
}
