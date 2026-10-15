using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Domain.Accounts;
using Vessel.Messaging;
using Vessel.Persistence;
using Vessel.Persistence.Events;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Tests;

/// <summary>Subscription runtime against PostgreSQL: registration, the one dispatcher, catch-up, retention, epoch.</summary>
public sealed class EventSubscriptionTests
{
    private static readonly EventSubscriptionLimits Fixed = new() { RetryJitter = 0, DiscoveryGrace = TimeSpan.Zero };

    // B2: a subscription registered later is not responsible for earlier events; provisioning never resets it.
    [VesselEventPostgresFact]
    public async Task Registration_is_insert_only_starts_at_the_current_sequence_and_rejects_a_changed_filter()
    {
        await using var runtime = await Runtime.CreateAsync();
        var first = await runtime.AppendAsync(Draft("before-1"));
        await runtime.AppendAsync(Draft("before-2"));
        var late = new EventSubscription("late", "tests", ["#"], Fixed);
        Assert.True(await runtime.RegisterAsync(late));
        Assert.Equal(DispatchOutcome.NotResponsible, (await runtime.DispatchAsync(late, first.Id)).Outcome);
        var after = await runtime.AppendAsync(Draft("after"));
        Assert.Equal(DispatchOutcome.Delivered, (await runtime.DispatchAsync(late, after.Id)).Outcome);
        Assert.Equal(3, (await runtime.CatchUpAsync(late)).LowWaterMark);
        Assert.Null(await runtime.ReceiptAsync(late, first.Id));
        Assert.False(await runtime.RegisterAsync(late));
        var status = Assert.Single(await runtime.StatusAsync());
        Assert.Equal((2L, 3L, "active"), (status.ResponsibleFrom, status.LowWaterMark, status.Status));
        var changed = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            runtime.RegisterAsync(new EventSubscription("late", "tests", ["play.#"], Fixed)));
        Assert.Contains("new subscription name", changed.Message);
    }

    // B1: owner validation, and the database rather than the message decides what an event is.
    [VesselEventPostgresFact]
    public async Task Dispatcher_validates_the_owner_and_trusts_the_database_not_the_message()
    {
        await using var runtime = await Runtime.CreateAsync();
        var all = await runtime.RegisterNewAsync("all");
        var retained = await runtime.AppendAsync(Draft("retained"));
        Assert.Equal(DispatchOutcome.InvalidOwner, (await runtime.DispatchAsync(all, retained.Id, Guid.NewGuid())).Outcome);
        Assert.True(new DispatchResult(DispatchOutcome.InvalidOwner).DeadLetter);
        Assert.Null(await runtime.ReceiptAsync(all, retained.Id));
        // Unknown: no retained event and no dedup identity, whatever the message would claim.
        var unknown = await runtime.DispatchAsync(all, Guid.CreateVersion7());
        Assert.Equal(DispatchOutcome.Unknown, unknown.Outcome);
        Assert.True(unknown.DeadLetter);
        // The handler sees the stored event, including its database sequence.
        Assert.Equal(DispatchOutcome.Delivered, (await runtime.DispatchAsync(all, retained.Id)).Outcome);
        Assert.Equal("1", runtime.Subscriber.Seen[retained.Id].Sequence);
        Assert.Equal(DispatchOutcome.AlreadySettled, (await runtime.DispatchAsync(all, retained.Id)).Outcome);
        // Known historical: pruned (dedup identity survives) or retained below the floor; acked, never recorded.
        var pruned = await runtime.AppendAsync(Draft("pruned"));
        await runtime.ExecuteAsync($"DELETE FROM events WHERE event_id='{pruned.Id}'");
        Assert.Equal(DispatchOutcome.Historical, (await runtime.DispatchAsync(all, pruned.Id)).Outcome);
        var below = await runtime.AppendAsync(Draft("below-floor"));
        await runtime.ExecuteAsync("UPDATE event_cursors SET retention_floor=3");
        var historical = await runtime.DispatchAsync(all, below.Id);
        Assert.Equal(DispatchOutcome.Historical, historical.Outcome);
        Assert.False(historical.DeadLetter);
        Assert.Null(await runtime.ReceiptAsync(all, pruned.Id));
        Assert.Null(await runtime.ReceiptAsync(all, below.Id));
    }

    // B1: no unbounded retry. Live delivery and catch-up share one attempt cap with doubling backoff.
    [VesselEventPostgresFact]
    public async Task Retries_back_off_share_one_attempt_cap_and_expired_or_unsupported_events_settle()
    {
        await using var runtime = await Runtime.CreateAsync();
        var capped = await runtime.RegisterNewAsync("capped", Fixed with { MaxAttempts = 3 });
        var failing = await runtime.AppendAsync(Draft("retry-1"));
        var start = runtime.Clock.GetUtcNow();
        Assert.Equal(DispatchOutcome.RetryScheduled, (await runtime.DispatchAsync(capped, failing.Id)).Outcome);
        Assert.Equal(("pending", 1), await runtime.ReceiptAsync(capped, failing.Id));
        Assert.Equal(start.AddMinutes(1), await runtime.NextAttemptAsync(capped, failing.Id));
        // A duplicate live delivery before the deadline is not another attempt; catch-up owns the retry.
        Assert.Equal(DispatchOutcome.NotDue, (await runtime.DispatchAsync(capped, failing.Id)).Outcome);
        Assert.Equal(0, (await runtime.CatchUpAsync(capped)).Retried);
        runtime.Clock.Advance(TimeSpan.FromSeconds(61));
        Assert.Equal(1, (await runtime.CatchUpAsync(capped)).Retried);
        Assert.Equal(("pending", 2), await runtime.ReceiptAsync(capped, failing.Id));
        Assert.Equal(runtime.Clock.GetUtcNow().AddMinutes(2), await runtime.NextAttemptAsync(capped, failing.Id));
        runtime.Clock.Advance(TimeSpan.FromMinutes(2));
        var final = await runtime.CatchUpAsync(capped);
        Assert.Equal(("failed", 3), await runtime.ReceiptAsync(capped, failing.Id));
        Assert.Equal(1, final.LowWaterMark);
        runtime.Clock.Advance(TimeSpan.FromHours(2));
        Assert.Equal(0, (await runtime.CatchUpAsync(capped)).Retried);
        Assert.Equal(3, runtime.Subscriber.Calls(failing.Id));
        Assert.Equal(TimeSpan.FromHours(1), Fixed.RetryDelay(20, 0.5));
        Assert.InRange(EventSubscriptionLimits.Default.RetryDelay(1, 0).TotalSeconds, 47.9, 48.1);

        var expiring = await runtime.AppendAsync(Draft("expiring") with { ExpiresAt = runtime.Clock.GetUtcNow().AddMinutes(1) });
        runtime.Clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal(DispatchOutcome.Expired, (await runtime.DispatchAsync(capped, expiring.Id)).Outcome);
        Assert.Equal(0, runtime.Subscriber.Calls(expiring.Id));
        var terminal = await runtime.AppendAsync(Draft("terminal"));
        var failed = await runtime.DispatchAsync(capped, terminal.Id);
        Assert.Equal((DispatchOutcome.Failed, true), (failed.Outcome, failed.DeadLetter));
        Assert.Equal("Synthetic permanent failure.", await runtime.ScalarAsync<string>(
            $"SELECT error FROM event_receipts WHERE event_id='{terminal.Id}'"));
        var future = await runtime.AppendAsync(Draft("future-version"));
        await runtime.ExecuteAsync($"UPDATE events SET payload=jsonb_set(payload,'{{version}}','2') WHERE event_id='{future.Id}'");
        Assert.Equal(DispatchOutcome.Failed, (await runtime.DispatchAsync(capped, future.Id)).Outcome);
        Assert.Equal(0, runtime.Subscriber.Calls(future.Id));
    }

    [VesselEventPostgresFact]
    public async Task Live_delivery_and_catch_up_race_on_one_receipt_without_double_effects()
    {
        await using var runtime = await Runtime.CreateAsync();
        var raced = await runtime.RegisterNewAsync("raced");
        var slow = await runtime.AppendAsync(Draft("slow"));
        runtime.Clock.Advance(TimeSpan.FromMinutes(1));
        var live = runtime.DispatchAsync(raced, slow.Id);
        await runtime.Subscriber.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        // Catch-up discovers the event (the live receipt is uncommitted) and must wait for it, not repeat it.
        var catchUp = runtime.CatchUpAsync(raced);
        await Task.Delay(300);
        runtime.Subscriber.Release.TrySetResult();
        Assert.Equal(DispatchOutcome.Delivered, (await live).Outcome);
        Assert.Equal(1, (await catchUp).Discovered);
        Assert.Equal(1, runtime.Subscriber.Calls(slow.Id));
        Assert.Equal(("delivered", 1), await runtime.ReceiptAsync(raced, slow.Id));
    }

    [VesselEventPostgresFact]
    public async Task Admin_retry_behind_the_low_water_mark_preserves_attempts_and_never_rewinds_the_mark()
    {
        await using var runtime = await Runtime.CreateAsync();
        var once = await runtime.RegisterNewAsync("once", Fixed with { MaxAttempts = 1, MaxAdminRetryBudget = 2 });
        var failing = await runtime.AppendAsync(Draft("retry-admin"));
        var ok = await runtime.AppendAsync(Draft("ok"));
        runtime.Clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(2, (await runtime.CatchUpAsync(once)).Discovered);
        Assert.Equal(("failed", 1), await runtime.ReceiptAsync(once, failing.Id));
        Assert.Equal(2, (await runtime.CatchUpAsync(once)).LowWaterMark);
        runtime.Subscriber.FailRetries = false;
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => runtime.RetryFailedAsync(once, 3));
        Assert.Equal(1, await runtime.RetryFailedAsync(once, 2));
        Assert.Equal(("pending", 1), await runtime.ReceiptAsync(once, failing.Id));
        // The retry is durable work: a later pass in a new scope (a crash before dispatch) still runs it.
        var retried = await runtime.CatchUpAsync(once);
        Assert.Equal((0, 1, 2L), (retried.Discovered, retried.Retried, retried.LowWaterMark));
        Assert.Equal(("delivered", 2), await runtime.ReceiptAsync(once, failing.Id));
        Assert.Equal(("delivered", 1), await runtime.ReceiptAsync(once, ok.Id));
    }

    [VesselEventPostgresFact]
    public async Task Low_water_mark_advances_over_holes_unmatched_and_terminal_events_but_never_past_unsettled_ones()
    {
        await using var runtime = await Runtime.CreateAsync();
        var plays = await runtime.RegisterNewAsync("plays", Fixed with { DiscoveryGrace = TimeSpan.FromHours(1) }, "play.#");
        await runtime.AppendAsync(Draft("unmatched"));
        var settled = await runtime.AppendAsync(Draft("settled", "play.status-changed"));
        var removed = await runtime.AppendAsync(Draft("removed", "play.status-changed"));
        var waiting = await runtime.AppendAsync(Draft("waiting", "play.status-changed"));
        var last = await runtime.AppendAsync(Draft("last", "play.status-changed"));
        Assert.Equal(DispatchOutcome.NotResponsible, (await runtime.DispatchAsync(plays, (await runtime.EventAsync("unmatched")).Id)).Outcome);
        await runtime.DispatchAsync(plays, settled.Id);
        await runtime.DispatchAsync(plays, last.Id);
        await runtime.ExecuteAsync($"DELETE FROM events WHERE event_id='{removed.Id}'");
        // Inside the grace period the waiting event is not discovered, so the mark stops before it.
        var first = await runtime.CatchUpAsync(plays);
        Assert.Equal((0, 3L), (first.Discovered, first.LowWaterMark));
        await runtime.DispatchAsync(plays, waiting.Id);
        Assert.Equal(5, (await runtime.CatchUpAsync(plays)).LowWaterMark);
        Assert.Equal(5, (await runtime.CatchUpAsync(plays)).LowWaterMark);
    }

    // B5/B6: contiguous prefix only, pending work holds retention, lagging subscriptions are released with a
    // recorded gap, physical deletion repeats safely and the cursor lock is not held while scanning.
    [VesselEventPostgresFact]
    public async Task Retention_prunes_a_contiguous_prefix_and_marks_lagging_subscriptions()
    {
        await using var runtime = await Runtime.CreateAsync(new VesselEventSettings { RetentionBatch = 1 });
        var fast = await runtime.RegisterNewAsync("fast");
        var slow = await runtime.RegisterNewAsync("slow");
        var old = runtime.Clock.GetUtcNow().AddDays(-100);
        var pendingOld = await runtime.AppendAsync(Draft("retry-old", detected: old));
        var deliveredOld = await runtime.AppendAsync(Draft("delivered-old", detected: old));
        await runtime.DispatchAsync(fast, pendingOld.Id);
        await runtime.DispatchAsync(fast, deliveredOld.Id);
        // B6: a pending receipt at sequence 1 holds the whole prefix; the floor never jumps over it.
        Assert.Equal(new RetentionResult(0, 0), await runtime.RetainAsync());
        Assert.Equal(2, (await EventReads.ReadAsync(runtime.Reader, 0, 10, default)).Events.Count);

        // B5: with an append holding the owner cursor, a floor decision still scans and decides without it.
        await using (var holder = new NpgsqlConnection(runtime.Database.ConnectionString))
        {
            await holder.OpenAsync();
            await using var hold = await holder.BeginTransactionAsync();
            await using (var lockCursor = new NpgsqlCommand("SELECT sequence FROM event_cursors FOR UPDATE", holder, hold))
                await lockCursor.ExecuteScalarAsync();
            Assert.Equal(0, await runtime.PublishFloorAsync().WaitAsync(TimeSpan.FromSeconds(10)));
            await hold.RollbackAsync();
        }

        runtime.Subscriber.FailRetries = false;
        runtime.Clock.Advance(TimeSpan.FromMinutes(2));
        await runtime.CatchUpAsync(fast);
        var recent = await runtime.AppendAsync(Draft("recent"));
        var result = await runtime.RetainAsync();
        Assert.Equal(new RetentionResult(2, 2), result);
        var lagging = (await runtime.StatusAsync()).Single(s => s.Name == slow.Name);
        Assert.Equal(("lagging", 1L, 2L), (lagging.Status, lagging.GapFrom, lagging.GapTo));
        Assert.Equal("active", (await runtime.StatusAsync()).Single(s => s.Name == fast.Name).Status);
        Assert.Equal(0, await runtime.CountAsync("SELECT count(*) FROM event_receipts WHERE sequence<=2"));
        Assert.Equal(3, await runtime.CountAsync("SELECT count(*) FROM event_dedup"));
        Assert.Equal(0, await runtime.DeleteBatchAsync());
        var page = await EventReads.ReadAsync(runtime.Reader, 0, 10, default);
        Assert.True(page.ResetRequired);
        Assert.Equal(recent.Id, Assert.Single((await EventReads.ReadAsync(runtime.Reader, 2, 10, default)).Events).Id);
        Assert.Equal(DispatchOutcome.Historical, (await runtime.DispatchAsync(slow, deliveredOld.Id)).Outcome);
        // The lagging subscription resumes past its gap and holds retention again.
        Assert.Equal(3, (await runtime.CatchUpAsync(slow)).LowWaterMark);
        var resumed = (await runtime.StatusAsync()).Single(s => s.Name == slow.Name);
        Assert.Equal(("active", 1L, 2L), (resumed.Status, resumed.GapFrom, resumed.GapTo));
        // Deregistering releases everything it held.
        Assert.True(await runtime.DeregisterAsync(slow));
        Assert.DoesNotContain(await runtime.StatusAsync(), s => s.Name == slow.Name);
    }

    [VesselEventPostgresFact]
    public async Task Maintenance_service_runs_catch_up_and_retention_for_the_subscriptions_its_host_runs()
    {
        await using var runtime = await Runtime.CreateAsync();
        var module = new ScriptedModule("maintained", Fixed with { CatchUpInterval = TimeSpan.FromSeconds(1) });
        Assert.True(await runtime.RegisterAsync(module.Subscriptions[0]));
        var pending = await runtime.AppendAsync(Draft("maintained"));
        runtime.Clock.Advance(TimeSpan.FromMinutes(1));
        var service = new SubscriptionMaintenanceService(new MessagingHost("maintained", runtime.Owner, [module]),
            runtime.Scopes, Microsoft.Extensions.Logging.Abstractions.NullLogger<SubscriptionMaintenanceService>.Instance);
        await service.StartAsync(default);
        try
        {
            for (var attempt = 0; attempt < 40 && (await runtime.StatusAsync()).Single().LowWaterMark == 0; attempt++)
                await Task.Delay(250);
        }
        finally { await service.StopAsync(default); }
        Assert.Equal(("delivered", 1), await runtime.ReceiptAsync(module.Subscriptions[0], pending.Id));
        Assert.Equal(1, (await runtime.StatusAsync()).Single().LowWaterMark);
    }

    // B7: a restored database is detected even after new writes reach the client's former sequence.
    [VesselEventPostgresFact]
    public async Task Restore_with_epoch_rotation_resets_a_cursor_the_database_has_caught_up_with()
    {
        await using var runtime = await Runtime.CreateAsync();
        foreach (var key in new[] { "a", "b", "c" }) await runtime.AppendAsync(Draft(key));
        var client = (await EventReads.ReadAsync(runtime.Reader, 0, 10, default)).NextCursor;
        // Restore a backup taken after event 1, then run the mandatory rotation of the restore procedure.
        await runtime.ExecuteAsync("""
            DELETE FROM events WHERE sequence>1;
            DELETE FROM event_dedup WHERE dedup_key IN ('b','c');
            UPDATE event_cursors SET sequence=1;
            """);
        Assert.Equal(1, await EventStreamEpoch.RotateAsync(runtime.Database.ConnectionString, default));
        foreach (var key in new[] { "x", "y" }) await runtime.AppendAsync(Draft(key));
        var history = new VesselEventHistory(runtime.Reader);
        var page = await history.ReadAsync(client, 10, default);
        Assert.True(page.ResetRequired, "A client at the old sequence 3 would silently miss x and y.");
        Assert.Empty(page.Events);
        Assert.NotEqual(client, page.NextCursor);
        Assert.EndsWith(".3", page.NextCursor);
        var resumed = await history.ReadAsync(page.NextCursor, 10, default);
        Assert.False(resumed.ResetRequired);
        Assert.Empty(resumed.Events);
        // The rotation command is an explicit offline entry point; migrate never rotates.
        var output = new StringWriter();
        Assert.Equal(0, await MessagingCommands.RunAsync(["rotate-event-epoch"], runtime.Configuration, output));
        Assert.Contains("Rotated the event stream epoch for 1 owner stream", output.ToString());
        Assert.True((await history.ReadAsync(page.NextCursor, 10, default)).ResetRequired);
    }

    // B3: no array options remain whose defaults a configured list would be appended to; maps bind exactly.
    [Fact]
    public void Messaging_and_event_settings_bind_exactly()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Vessel:Messaging:RabbitMqUri"] = "amqp://synthetic:synthetic@127.0.0.1:1",
            ["Vessel:Messaging:StorageSchemas:api"] = "wolverine_custom",
            ["Vessel:Events:DurableConsumers:0"] = "discord"
        }).Build();
        var settings = MessagingHosting.Settings(config);
        Assert.Equal(new Dictionary<string, string> { ["api"] = "wolverine_custom" }, settings.StorageSchemas);
        Assert.Equal(("wolverine_custom", "wolverine_monitor"), (settings.SchemaFor("api"), settings.SchemaFor("monitor")));
        Assert.Equal(20, settings.DeliveryLimit);
        foreach (var type in new[] { typeof(MessagingSettings), typeof(VesselEventSettings) })
            Assert.DoesNotContain(type.GetProperties(), p => p.PropertyType.IsArray ||
                p.PropertyType.IsGenericType && p.PropertyType.GetGenericTypeDefinition() == typeof(List<>));
        var services = new ServiceCollection();
        services.AddVesselEvents(config);
        using var provider = services.BuildServiceProvider();
        Assert.Equal(90, provider.GetRequiredService<IOptions<VesselEventSettings>>().Value.RetentionDays);
        Assert.True(TopicFilter.Matches("play.#", "play.status-changed"));
        Assert.True(TopicFilter.Matches("#", "monitor.run-completed"));
        Assert.True(TopicFilter.Matches("discrepancy.*", "discrepancy.opened"));
        Assert.False(TopicFilter.Matches("discrepancy.*", "play.opened"));
        Assert.False(TopicFilter.Valid("Play.#"));
        Assert.Equal(new EventSubscription("a", "m", ["play.#", "#"]).Fingerprint, new EventSubscription("a", "m", ["#", "play.#", "#"]).Fingerprint);
    }

    private static VesselEventDraft Draft(string key, string type = "monitor.state-changed", DateTimeOffset? detected = null) =>
        new(type, Guid.CreateVersion7(), key, "info", detected ?? DateTimeOffset.UtcNow, detected ?? DateTimeOffset.UtcNow,
            new(), new("owner"), JsonSerializer.SerializeToElement(new { previous = "live", current = "degraded" }));

    internal sealed class ManualClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }

    internal sealed class GatedSubscriber : IVesselEventSubscriber
    {
        private readonly ConcurrentDictionary<Guid, int> calls = new();
        public ConcurrentDictionary<Guid, VesselEvent> Seen { get; } = new();
        public bool FailRetries { get; set; } = true;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls(Guid id) => calls.GetValueOrDefault(id);

        public async Task<EventHandling> HandleAsync(VesselEvent message, CancellationToken cancellationToken)
        {
            calls.AddOrUpdate(message.Id, 1, (_, count) => count + 1);
            Seen[message.Id] = message;
            if (message.DedupKey == "slow")
            {
                Entered.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            }
            if (FailRetries && message.DedupKey.StartsWith("retry", StringComparison.Ordinal))
                throw new InvalidOperationException("Synthetic retryable failure.");
            if (message.DedupKey.StartsWith("terminal", StringComparison.Ordinal))
                throw new TerminalEventException("Synthetic permanent failure.");
            return EventHandling.Delivered;
        }
    }

    private sealed class Runtime : IAsyncDisposable
    {
        private readonly ServiceProvider provider;

        private Runtime(CoreDatabase database, VesselEventSettings? settings)
        {
            Database = database;
            Reader = database.Context(Owner);
            Configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Vessel"] = database.ConnectionString,
                ["Vessel:Auth:OwnerId"] = Owner.ToString(),
                ["Vessel:Events:RetentionBatch"] = (settings?.RetentionBatch ?? 1000).ToString()
            }).Build();
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IJournalOwnerContext>(new CoreOwner(Owner));
            services.AddSingleton<TimeProvider>(Clock);
            services.AddVesselPersistence(Configuration);
            services.AddVesselEvents(Configuration);
            services.AddScoped<IVesselEventOutbox, NoOutbox>();
            services.AddKeyedSingleton<IVesselEventSubscriber>(KeyedService.AnyKey, Subscriber);
            provider = services.BuildServiceProvider();
        }

        public CoreDatabase Database { get; }
        public Guid Owner { get; } = Guid.NewGuid();
        public ManualClock Clock { get; } = new();
        public GatedSubscriber Subscriber { get; } = new();
        public VesselDbContext Reader { get; }
        public IConfiguration Configuration { get; }

        public static async Task<Runtime> CreateAsync(VesselEventSettings? settings = null) =>
            new(await CoreDatabase.CreateAsync(), settings);

        public AsyncServiceScope Scope() => provider.CreateAsyncScope();
        public IServiceScopeFactory Scopes => provider.GetRequiredService<IServiceScopeFactory>();

        public async Task<VesselEvent> AppendAsync(VesselEventDraft draft)
        {
            await using (var scope = Scope())
            {
                var sink = scope.ServiceProvider.GetRequiredService<IVesselEventSink>();
                await scope.ServiceProvider.GetRequiredService<IUnitOfWork>().ExecuteAsync(async () =>
                {
                    await sink.AppendAsync(draft, default);
                    return true;
                }, default);
            }
            return await EventAsync(draft.DedupKey);
        }

        public async Task<VesselEvent> EventAsync(string key) =>
            (await EventReads.ReadAsync(Reader, 0, 200, default)).Events.Single(e => e.DedupKey == key);

        public async Task<EventSubscription> RegisterNewAsync(string name, EventSubscriptionLimits? limits = null, params string[] filters)
        {
            var subscription = new EventSubscription(name, "tests", filters.Length == 0 ? ["#"] : filters, limits ?? Fixed);
            Assert.True(await RegisterAsync(subscription));
            return subscription;
        }

        public async Task<bool> RegisterAsync(EventSubscription subscription)
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventSubscriptionRegistry>().RegisterAsync(subscription, default);
        }

        public async Task<bool> DeregisterAsync(EventSubscription subscription)
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventSubscriptionRegistry>().DeregisterAsync(subscription.Name, default);
        }

        public async Task<IReadOnlyList<EventSubscriptionStatus>> StatusAsync()
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventSubscriptionRegistry>().ListAsync(default);
        }

        public async Task<DispatchResult> DispatchAsync(EventSubscription subscription, Guid eventId, Guid? owner = null)
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventDispatcher>()
                .DispatchAsync(subscription, owner ?? Owner, eventId, DispatchTrigger.Live, default);
        }

        public async Task<CatchUpResult> CatchUpAsync(EventSubscription subscription)
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventCatchUp>().RunAsync(subscription, default);
        }

        public async Task<int> RetryFailedAsync(EventSubscription subscription, int extra)
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventReceiptAdmin>().RetryFailedAsync(subscription, 10, extra, default);
        }

        public async Task<RetentionResult> RetainAsync()
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventRetention>().RunAsync(default);
        }

        public async Task<long> PublishFloorAsync()
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventRetention>().PublishFloorAsync(default);
        }

        public async Task<int> DeleteBatchAsync()
        {
            await using var scope = Scope();
            return await scope.ServiceProvider.GetRequiredService<EventRetention>().DeleteBatchAsync(default);
        }

        public async Task<(string State, int Attempts)?> ReceiptAsync(EventSubscription subscription, Guid eventId)
        {
            await using var connection = await OpenAsync();
            await using var command = new NpgsqlCommand(
                "SELECT state,attempts FROM event_receipts WHERE subscription=@name AND event_id=@id", connection);
            command.Parameters.AddWithValue("name", subscription.Name);
            command.Parameters.AddWithValue("id", eventId);
            await using var row = await command.ExecuteReaderAsync();
            return await row.ReadAsync() ? (row.GetString(0), row.GetInt32(1)) : null;
        }

        public async Task<DateTimeOffset> NextAttemptAsync(EventSubscription subscription, Guid eventId) => new(DateTime.SpecifyKind(
            await ScalarAsync<DateTime>($"SELECT next_attempt_at FROM event_receipts WHERE subscription='{subscription.Name}' AND event_id='{eventId}'"),
            DateTimeKind.Utc));

        public async Task<T?> ScalarAsync<T>(string sql)
        {
            await using var connection = await OpenAsync();
            await using var command = new NpgsqlCommand(sql, connection);
            return await command.ExecuteScalarAsync() is T value ? value : default;
        }

        public async Task<long> CountAsync(string sql) => Convert.ToInt64(await ScalarAsync<object>(sql));

        public async Task ExecuteAsync(string sql)
        {
            await using var connection = await OpenAsync();
            await using var command = new NpgsqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync();
        }

        private async Task<NpgsqlConnection> OpenAsync()
        {
            var connection = new NpgsqlConnection(Database.ConnectionString);
            await connection.OpenAsync();
            return connection;
        }

        public async ValueTask DisposeAsync()
        {
            await Reader.DisposeAsync();
            await provider.DisposeAsync();
            await Database.DisposeAsync();
        }
    }

    private sealed class NoOutbox : IVesselEventOutbox
    {
        public Task StageAsync(VesselEvent message, CancellationToken ct) => Task.CompletedTask;
        public Task StageAsync(MonitorAccountCommand command, CancellationToken ct) => Task.CompletedTask;
        public Task FlushAsync(CancellationToken ct) => Task.CompletedTask;
        public void Reset() { }
    }
}
