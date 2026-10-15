using Vessel.Application.Common;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Application.Events;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Persistence;

namespace Vessel.Tests;

public sealed class MonitorPostgresTests
{
    [PostgresFact]
    public async Task Rejected_order_credential_pauses_scheduled_monitoring_instead_of_generic_retry()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        var clock = new Clock(DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        await using var db = database.Context(owner);
        var play = new Play(Guid.NewGuid(), await db.Accounts.SingleAsync(), new PerpetualInstrument("hyperliquid", "BTC"),
            InstrumentSource.Venue, "{}", clock.Now.AddMinutes(-2));
        play.MarkPlanned(clock.Now.AddMinutes(-1));
        db.Add(play);
        await db.SaveChangesAsync();
        var coordinator = Coordinator(db, owner, new Reader(), clock: clock,
            orders: new Orders { Failure = new VenueCredentialRejectedException() });
        var request = await coordinator.RequestAsync(id, default);
        var store = new MonitorStore(db, TestUnitOfWork.For(db));
        var lease = (await store.ClaimAsync(id, request.RequestId, "worker", clock.Now, default))!;
        Assert.False(await coordinator.RunAsync(lease, default));
        var row = (await store.FindAsync(id, default))!;
        Assert.Equal("credential-error", row.State);
        Assert.Null(row.NextRunAtUtc);
        Assert.Null(row.LastSuccessAtUtc);
        Assert.Equal(clock.Now.AddSeconds(60), row.NextManualAllowedAtUtc);
        clock.Now = clock.Now.AddHours(1);
        await store.DiscoverAsync(["hyperliquid"], clock.Now, default);
        Assert.Empty(await store.ClaimDueAsync("scheduler", clock.Now, 2, default));
    }

    [PostgresFact]
    public async Task Venue_retry_budget_survives_scopes_and_blocks_refresh_manual_scheduled_and_command_claims()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var ids = await AccountsAsync(database, owner, 3);
        var clock = new Clock(DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        await using (var seed = database.Context(owner))
        {
            foreach (var account in await seed.Accounts.ToListAsync())
            {
                var play = new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", "BTC"),
                    InstrumentSource.Venue, "{}", clock.Now.AddMinutes(-2));
                play.MarkPlanned(clock.Now.AddMinutes(-1));
                seed.Add(play);
            }
            await seed.SaveChangesAsync();
        }
        Guid pending;
        await using (var api = database.Context(owner))
            pending = (await Coordinator(api, owner, new Reader(), clock: clock).RequestAsync(ids[1], default)).RequestId;
        var deadline = clock.Now.AddSeconds(600);
        await using (var worker = database.Context(owner))
        {
            var coordinator = Coordinator(worker, owner, new Reader { Failure = new VenueRateLimitException(deadline) }, clock: clock);
            var lease = await coordinator.AdmitRefreshAsync(ids[0], "api", default);
            Assert.False(await coordinator.RunAsync(lease, default));
            var row = (await new MonitorStore(worker, TestUnitOfWork.For(worker)).FindAsync(ids[0], default))!;
            Assert.Equal(deadline, row.NextRunAtUtc);
            Assert.Equal(deadline, row.NextManualAllowedAtUtc);
        }
        await using (var anotherProcess = database.Context(owner))
        {
            var store = new MonitorStore(anotherProcess, TestUnitOfWork.For(anotherProcess));
            await store.DeferVenueAsync("hyperliquid", clock.Now.AddSeconds(120), default);
            Assert.Equal(deadline, await store.VenueRetryAtAsync("hyperliquid", default));
            Assert.Null(await store.VenueRetryAtAsync("risex", default));
            await store.DiscoverAsync(["hyperliquid"], clock.Now, default);
            Assert.Empty(await store.ClaimDueAsync("scheduler", clock.Now, 2, default));
            Assert.Null(await store.ClaimAsync(ids[1], pending, "command", clock.Now, default));
            Assert.Equal(deadline, (await Coordinator(anotherProcess, owner, new Reader(), clock: clock)
                .AccountAsync(ids[2], default)).NextManualAllowedAtUtc);
        }
        // Each denied API request gets its own scope, just as separate API instances do.
        await using (var api = database.Context(owner))
            Assert.Equal(600, (await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
                Coordinator(api, owner, new Reader(), clock: clock).AdmitRefreshAsync(ids[2], "api", default))).RetryAfter);
        await using (var api = database.Context(owner))
            Assert.Equal(600, (await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
                Coordinator(api, owner, new Reader(), clock: clock).RequestAsync(ids[2], default))).RetryAfter);
        var foreignOwner = Guid.NewGuid();
        var foreignId = (await AccountsAsync(database, foreignOwner, 1)).Single();
        await using (var foreign = database.Context(foreignOwner))
        {
            Assert.Null(await new MonitorStore(foreign, TestUnitOfWork.For(foreign)).VenueRetryAtAsync("hyperliquid", default));
            Assert.NotNull(await Coordinator(foreign, foreignOwner, new Reader(), clock: clock).AdmitRefreshAsync(foreignId, "foreign", default));
        }
        clock.Now = deadline;
        await using (var resumed = database.Context(owner))
        {
            var store = new MonitorStore(resumed, TestUnitOfWork.For(resumed));
            Assert.Equal(pending, (await store.ClaimAsync(ids[1], pending, "command", clock.Now, default))!.RequestId);
            Assert.Single(await store.ClaimDueAsync("scheduler", clock.Now, 2, default));
        }
    }

    [PostgresFact]
    public async Task A_new_throttle_between_claim_and_read_defers_the_same_request_without_network()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        var clock = new Clock(DateTimeOffset.UtcNow);
        await using var db = database.Context(owner);
        var coordinator = Coordinator(db, owner, new Reader { BeforeRead = _ => throw new Exception("Must not read.") }, clock: clock);
        var lease = await coordinator.AdmitRefreshAsync(id, "api", default);
        await using (var concurrent = database.Context(owner))
            await new MonitorStore(concurrent, TestUnitOfWork.For(concurrent))
                .DeferVenueAsync("hyperliquid", clock.Now.AddSeconds(600), default);
        Assert.Equal(600, (await Assert.ThrowsAsync<MonitorAdmissionException>(() => coordinator.RunAsync(lease, default))).RetryAfter);
        var store = new MonitorStore(db, TestUnitOfWork.For(db));
        var pending = (await store.FindAsync(id, default))!;
        Assert.Equal(lease.RequestId, pending.RequestId);
        Assert.Equal("pending", pending.ManualState);
        Assert.Null(pending.LeaseUntilUtc);
        Assert.Null(pending.LastSuccessAtUtc);
        clock.Now = clock.Now.AddSeconds(600);
        var resumed = Assert.Single(await store.ClaimDueAsync("scheduler", clock.Now, 2, default));
        Assert.Equal(lease.RequestId, resumed.RequestId);
        Assert.True(resumed.Generation > lease.Generation);
    }

    [PostgresFact]
    public async Task Optional_order_rate_limit_preserves_public_refresh_and_persists_venue_budget()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var ids = await AccountsAsync(database, owner, 2);
        var clock = new Clock(DateTimeOffset.UtcNow);
        await using (var db = database.Context(owner))
        {
            var coordinator = Coordinator(db, owner, new Reader(), clock: clock,
                orders: new Orders { Failure = new VenueRateLimitException(clock.Now.AddSeconds(600)) });
            var lease = await coordinator.AdmitRefreshAsync(ids[0], "api", default);
            Assert.True(await coordinator.RunAsync(lease, default));
            var account = await db.Accounts.SingleAsync(a => a.Id == ids[0]);
            Assert.Equal("synced", account.SyncStatus);
            Assert.Contains("rate limit", account.HistoryNotice);
            Assert.Single(await db.Snapshots.ToListAsync());
            Assert.Empty(await db.Orders.ToListAsync());
        }
        await using var api = database.Context(owner);
        Assert.Equal(600, (await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
            Coordinator(api, owner, new Reader(), clock: clock).AdmitRefreshAsync(ids[1], "api", default))).RetryAfter);
    }

    [PostgresFact]
    public async Task A_rate_limit_is_retained_even_if_account_settings_changed_during_the_failed_read()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var ids = await AccountsAsync(database, owner, 2);
        var clock = new Clock(DateTimeOffset.UtcNow);
        await using (var db = database.Context(owner))
        {
            var reader = new Reader
            {
                BeforeRead = async _ =>
                {
                    await using var changed = database.Context(owner);
                    var account = await changed.Accounts.SingleAsync(a => a.Id == ids[0]);
                    account.UpdateSettings("Renamed during read", null, true);
                    await changed.SaveChangesAsync();
                },
                Failure = new VenueRateLimitException(clock.Now.AddSeconds(600))
            };
            var coordinator = Coordinator(db, owner, reader, clock: clock);
            Assert.False(await coordinator.RunAsync(await coordinator.AdmitRefreshAsync(ids[0], "api", default), default));
        }
        await using var api = database.Context(owner);
        Assert.Equal(600, (await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
            Coordinator(api, owner, new Reader(), clock: clock).AdmitRefreshAsync(ids[1], "api", default))).RetryAfter);
    }

    [PostgresFact]
    public async Task Scheduled_claim_coalesces_an_accepted_manual_command_and_completion_rejects_replay()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using (var seeding = database.Context(owner))
        {
            var play = new Play(Guid.NewGuid(), await seeding.Accounts.SingleAsync(),
                new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue, "{}", DateTimeOffset.UtcNow.AddMinutes(-1));
            play.MarkPlanned(DateTimeOffset.UtcNow.AddSeconds(-30));
            seeding.Add(play);
            await seeding.SaveChangesAsync();
        }
        MonitorRunAccepted accepted;
        await using (var api = database.Context(owner))
            accepted = await Coordinator(api, owner, new Reader()).RequestAsync(id, default);
        Assert.Equal("pending", accepted.Monitor.ManualState);
        await using (var worker = database.Context(owner))
        {
            var store = new MonitorStore(worker, TestUnitOfWork.For(worker));
            var lease = Assert.Single(await store.ClaimDueAsync("scheduler", DateTimeOffset.UtcNow, 2, default));
            Assert.Equal(accepted.RequestId, lease.RequestId);
            Assert.Null(await store.ClaimAsync(id, accepted.RequestId, "duplicate-command", DateTimeOffset.UtcNow, default));
            Assert.True(await Coordinator(worker, owner, new Reader()).RunAsync(lease, default));
        }
        await using var replay = database.Context(owner);
        Assert.Null(await new MonitorStore(replay, TestUnitOfWork.For(replay))
            .ClaimAsync(id, accepted.RequestId, "delayed-command", DateTimeOffset.UtcNow, default));
        await Assert.ThrowsAsync<MonitorAdmissionException>(() => Coordinator(replay, owner, new Reader()).RequestAsync(id, default));
    }

    [PostgresFact]
    public async Task Terminal_exit_followup_needs_fresh_complete_absence_and_reopens_after_link_revision()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        var now = DateTimeOffset.UtcNow;
        await using var db = database.Context(owner);
        var play = new Play(Guid.NewGuid(), await db.Accounts.SingleAsync(),
            new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue, "{}", now.AddMinutes(-10));
        play.MarkPlanned(now.AddMinutes(-9));
        var link = new PlayOrderLink(play, "stop-1", OrderLinkRole.Stop, "entry-1", "stop-1",
            OrderLinkState.Linked, OrderLinkSource.Owner, now.AddMinutes(-8));
        play.Cancel(CancelReason.ChangedMind, null, now);
        db.AddRange(play, link);
        await db.SaveChangesAsync();
        var work = TestUnitOfWork.For(db); var store = new MonitorStore(db, work);
        Assert.True(await store.EligibleAsync(id, default));
        async Task Observe(VenueOrderReadResult read) => await work.ExecuteAsync(async () =>
        {
            await store.ResolveExitsAsync(id, read, default);
            await work.SaveChangesAsync(default);
            return true;
        }, default);
        await Observe(new([], now.AddSeconds(1), "Incomplete", OpenOrdersComplete: false));
        Assert.True(await store.EligibleAsync(id, default));
        await Observe(new([], now.AddSeconds(-1), "Earlier than cancellation", OpenOrdersComplete: true));
        Assert.True(await store.EligibleAsync(id, default));
        await Observe(new([], now.AddSeconds(2), "Fresh absence", OpenOrdersComplete: true));
        Assert.False(await store.EligibleAsync(id, default));
        link.Confirm(now.AddSeconds(3));
        await db.SaveChangesAsync();
        Assert.True(await store.EligibleAsync(id, default));
        await Observe(new([new("stop-1", "BTC", "sell", "Stop", 90, 90, true, false, 1, 1,
            now.AddMinutes(-8), VenueOrderStatus.Open, "open", now.AddSeconds(4))],
            now.AddSeconds(4), "Still resting", OpenOrdersComplete: true));
        Assert.True(await store.EligibleAsync(id, default));
        Assert.Null((await db.Set<MonitorExitWatch>().SingleAsync()).ResolvedAtUtc);
    }

    [PostgresFact]
    public async Task Refresh_retains_orders_without_reconciliation_and_preserves_pending_confirmation()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using var db = database.Context(owner);
        var now = DateTimeOffset.UtcNow;
        var play = new Play(Guid.NewGuid(), await db.Accounts.SingleAsync(),
            new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue, "{}", now.AddMinutes(-1));
        play.MarkPlanned(now.AddSeconds(-30));
        db.Add(play);
        db.Add(new MonitorAccount { OwnerId = owner, AccountId = id, State = "live",
            NextRunAtUtc = now.AddSeconds(80), ConfirmationAtUtc = now.AddSeconds(80) });
        await db.SaveChangesAsync();
        var importer = new Importer();
        var coordinator = Coordinator(db, owner, new Reader(), importer: importer);
        var lease = await coordinator.AdmitRefreshAsync(id, "refresh", default);
        Assert.True(await coordinator.RunAsync(lease, default));
        Assert.Equal(1, importer.Retained);
        Assert.Equal(0, importer.Reconciled);
        db.ChangeTracker.Clear();
        var row = await db.Set<MonitorAccount>().SingleAsync();
        Assert.NotNull(row.ConfirmationAtUtc);
        Assert.Equal(row.ConfirmationAtUtc, row.NextRunAtUtc);
        Assert.Equal(PlayStatus.Planned, (await db.Plays.SingleAsync()).Status);
    }

    [PostgresFact]
    public async Task Order_failure_does_not_discard_successful_public_refresh_or_leak_error_payloads()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using var db = database.Context(owner);
        var importer = new Importer();
        var coordinator = Coordinator(db, owner, new Reader(), importer: importer,
            orders: new Orders { Failure = new HttpRequestException("https://secret.invalid/?token=SECRET") });
        var lease = await coordinator.AdmitRefreshAsync(id, "refresh", default);
        Assert.True(await coordinator.RunAsync(lease, default));
        db.ChangeTracker.Clear();
        Assert.Single(await db.Snapshots.ToListAsync());
        var account = await db.Accounts.SingleAsync();
        Assert.NotNull(account.LastSyncedAtUtc);
        Assert.Contains("order coverage is unavailable", account.HistoryNotice);
        Assert.DoesNotContain("SECRET", account.HistoryNotice);
        Assert.Equal(0, importer.Reconciled);
        Assert.Equal(0, importer.Retained);
        var row = await db.Set<MonitorAccount>().SingleAsync();
        Assert.NotNull(row.NextManualAllowedAtUtc);
        Assert.Contains("order coverage is unavailable", row.Error);
    }

    [PostgresFact]
    public async Task Cancelling_optional_orders_preserves_committed_public_import_without_holding_a_network_lock()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using var db = database.Context(owner);
        using var cancelled = new CancellationTokenSource();
        var orders = new Orders
        {
            BeforeRead = async ct =>
            {
                Assert.Null(db.Database.CurrentTransaction);
                await using var observed = database.Context(owner);
                Assert.Single(await observed.Snapshots.ToListAsync(ct));
                Assert.Equal("synced", (await observed.Accounts.SingleAsync(ct)).SyncStatus);
                cancelled.Cancel();
                ct.ThrowIfCancellationRequested();
            }
        };
        var coordinator = Coordinator(db, owner, new Reader(), orders: orders);
        var lease = await coordinator.AdmitRefreshAsync(id, "refresh", cancelled.Token);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => coordinator.RunAsync(lease, cancelled.Token));
        db.ChangeTracker.Clear();
        Assert.Single(await db.Snapshots.ToListAsync());
        Assert.Equal("synced", (await db.Accounts.SingleAsync()).SyncStatus);
        Assert.Empty(await db.Orders.ToListAsync());
        var row = await db.Set<MonitorAccount>().SingleAsync();
        Assert.Equal("idle", row.ManualState);
        Assert.NotNull(row.NextManualAllowedAtUtc);
    }

    [PostgresFact]
    public async Task Refresh_admission_is_shared_across_scopes_and_global_read_budget_is_two()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var ids = await AccountsAsync(database, owner, 3);
        await using var first = database.Context(owner);
        var a = Coordinator(first, owner, new Reader());
        var lease = await a.AdmitRefreshAsync(ids[0], "first", default);
        await using var second = database.Context(owner);
        var b = Coordinator(second, owner, new Reader());
        Assert.True((await Assert.ThrowsAsync<MonitorAdmissionException>(() => b.AdmitRefreshAsync(ids[0], "other-tab", default))).RetryAfter > 0);
        _ = await b.AdmitRefreshAsync(ids[1], "second", default);
        await using var third = database.Context(owner);
        Assert.Equal(30, (await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
            Coordinator(third, owner, new Reader()).AdmitRefreshAsync(ids[2], "third", default))).RetryAfter);
        Assert.False(await new MonitorStore(third, TestUnitOfWork.For(third))
            .RenewAsync(lease with { Generation = lease.Generation - 1 }, DateTimeOffset.UtcNow, default));
    }

    [PostgresFact]
    public async Task Baseline_commits_before_network_and_settings_change_discards_the_observation_without_blocking_update()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using var db = database.Context(owner);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sink = new EventSink();
        var reader = new Reader
        {
            BeforeRead = async ct =>
            {
                Assert.True(sink.Baseline);
                Assert.Null(db.Database.CurrentTransaction);
                entered.SetResult();
                await gate.Task.WaitAsync(ct);
            }
        };
        var monitor = Coordinator(db, owner, reader, sink);
        var lease = await monitor.AdmitRefreshAsync(id, "worker", default);
        var run = monitor.RunAsync(lease, default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await using (var updating = database.Context(owner))
        {
            var work = TestUnitOfWork.For(updating);
            await work.ExecuteAsync(() => new WorkspaceStore(updating, work).WithAccountLockAsync(id, async account =>
            {
                account.UpdateSettings("Disabled during read", null, false);
                await work.SaveChangesAsync(default);
                return true;
            }, default), default).WaitAsync(TimeSpan.FromSeconds(5));
        }
        gate.SetResult();
        Assert.False(await run);
        db.ChangeTracker.Clear();
        Assert.Empty(await db.Snapshots.ToListAsync());
        var row = await db.Set<MonitorAccount>().SingleAsync();
        Assert.Equal("idle", row.State);
        Assert.Equal("idle", row.ManualState);
        Assert.NotNull(row.NextManualAllowedAtUtc);
    }

    [PostgresFact]
    public async Task Failed_network_attempt_records_safe_error_and_cooldown_persisted_for_next_API_scope()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using (var db = database.Context(owner))
        {
            var monitor = Coordinator(db, owner, new Reader { Failure = new HttpRequestException("ro:SECRET?auth=TOKEN") });
            var lease = await monitor.AdmitRefreshAsync(id, "worker", default);
            Assert.False(await monitor.RunAsync(lease, default));
        }
        await using var next = database.Context(owner);
        var state = await Coordinator(next, owner, new Reader()).AccountAsync(id, default);
        Assert.Equal("degraded", state.State);
        Assert.DoesNotContain("SECRET", state.Error);
        Assert.DoesNotContain("TOKEN", state.Error);
        Assert.Null(state.LastSuccessAtUtc);
        var refused = await Assert.ThrowsAsync<MonitorAdmissionException>(() =>
            Coordinator(next, owner, new Reader()).AdmitRefreshAsync(id, "next-tab", default));
        Assert.InRange(refused.RetryAfter, 1, 60);
    }

    [PostgresFact]
    public async Task Expired_lease_recovery_fences_a_late_network_result()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        var clock = new Clock(DateTimeOffset.UtcNow);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var reader = new Reader { BeforeRead = async ct => { entered.SetResult(); await gate.Task.WaitAsync(ct); } };
        await using var db = database.Context(owner);
        var monitor = Coordinator(db, owner, reader, clock: clock);
        var original = await monitor.AdmitRefreshAsync(id, "lost-worker", default);
        var running = monitor.RunAsync(original, default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        clock.Now += MonitorOptions.Lease;
        await using var recovered = database.Context(owner);
        var next = await new MonitorStore(recovered, TestUnitOfWork.For(recovered))
            .ClaimAsync(id, original.RequestId, "new-worker", clock.Now, default);
        Assert.NotNull(next);
        Assert.Equal(original.Generation + 1, next.Generation);
        gate.SetResult();
        Assert.False(await running);
        Assert.Empty(await recovered.Snapshots.ToListAsync());
        recovered.ChangeTracker.Clear();
        Assert.Equal("new-worker", (await recovered.Set<MonitorAccount>().SingleAsync()).LeaseHolder);
    }

    [PostgresFact]
    public async Task Heartbeat_and_account_monitor_rows_are_owner_scoped()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var id = (await AccountsAsync(database, owner, 1)).Single();
        await using (var db = database.Context(owner))
        {
            _ = await Coordinator(db, owner, new Reader()).AdmitRefreshAsync(id, "worker", default);
            await new MonitorStore(db, TestUnitOfWork.For(db)).RecordHeartbeatAsync("worker", DateTimeOffset.UtcNow, default);
        }
        await using var foreign = database.Context(Guid.NewGuid());
        Assert.Empty(await foreign.Set<MonitorAccount>().ToListAsync());
        Assert.Null(await new MonitorStore(foreign, TestUnitOfWork.For(foreign)).HeartbeatAsync(default));
        Assert.Equal(404, (await Assert.ThrowsAsync<ProblemException>(() =>
            Coordinator(foreign, foreign.CurrentOwnerId, new Reader()).AccountAsync(id, default))).StatusCode);
    }

    private static async Task<Guid[]> AccountsAsync(CoreDatabase database, Guid owner, int count)
    {
        await using var db = database.Context(owner);
        var accounts = Enumerable.Range(0, count).Select(i =>
        {
            var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Monitor " + i);
            account.Configure(null, "0x" + Guid.NewGuid().ToString("N") + "00000000", null);
            return account;
        }).ToArray();
        db.Accounts.AddRange(accounts);
        await db.SaveChangesAsync();
        return accounts.Select(a => a.Id).ToArray();
    }

    private static MonitorCoordinator Coordinator(VesselDbContext db, Guid owner, Reader reader, EventSink? sink = null,
        TimeProvider? clock = null, Importer? importer = null, Orders? orders = null)
    {
        var work = TestUnitOfWork.For(db);
        return new(new MonitorStore(db, work), new WorkspaceStore(db, work), importer ?? new Importer(), TestVenues.With(reader, orders ?? new Orders()),
            new Credentials(), work, sink ?? new EventSink(), new Commands(), new CoreOwner(owner),
            new MonitorOptions(), clock ?? TimeProvider.System);
    }

    private sealed class Reader : IPerpetualVenueReader
    {
        public string VenueId => "hyperliquid";
        public Func<CancellationToken, Task>? BeforeRead { get; init; }
        public Exception? Failure { get; init; }
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<VenueInstrument>>([]);
        public async Task<PerpetualVenueReadResult> ReadAsync(string source, CancellationToken ct)
        {
            if (BeforeRead is { } before) await before(ct);
            if (Failure is { } failure) throw failure;
            return new(new(DateTimeOffset.UtcNow, "synthetic", 100, 100, 0, []), [], [], "Synthetic isolated read",
                PositionsComplete: true, FillHistoryComplete: true);
        }
    }
    private sealed class Importer : IMonitorImporter
    {
        public int Retained;
        public int Reconciled;
        public Task RetainAsync(Account account, VenueOrderReadResult orders, CancellationToken ct) { Retained++; return Task.CompletedTask; }
        public Task ReconcileAsync(Account account, VenueOrderReadResult orders, IReadOnlyList<VenueInstrument> instruments, CancellationToken ct)
            { Reconciled++; return Task.CompletedTask; }
    }
    private sealed class Orders : IVenueOrderReader
    {
        public string VenueId => "hyperliquid";
        public Exception? Failure { get; init; }
        public Func<CancellationToken, Task>? BeforeRead { get; init; }
        public async Task<VenueOrderReadResult> ReadOrdersAsync(string source, CancellationToken ct)
        {
            if (BeforeRead is { } before) await before(ct);
            if (Failure is { } failure) throw failure;
            return new([], DateTimeOffset.UtcNow, "Synthetic isolated orders", OpenOrdersComplete: true);
        }
    }
    private sealed class Credentials : IAccountCredentialReader
    {
        public Task<string?> ReadAsync(Guid accountId, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task MarkRefusedAsync(Guid accountId, string attemptedRevision, CancellationToken ct) => Task.CompletedTask;
    }
    private sealed class Commands : IMonitorCommandSink
    {
        public Task EnqueueAsync(MonitorAccountCommand command, CancellationToken ct) => Task.CompletedTask;
    }
    private sealed class EventSink : IVesselEventSink
    {
        public bool Baseline;
        public Task SetRunAsync(Guid runId, string trigger, CancellationToken ct) => Task.CompletedTask;
        public Task EnsureMonitoringBaselineAsync(Guid accountId, CancellationToken ct) { Baseline = true; return Task.CompletedTask; }
        public Task AppendAsync(VesselEventDraft draft, CancellationToken ct) => Task.CompletedTask;
    }
    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
