using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Vessel.Application.Events;
using Vessel.Application.Notifications;
using Vessel.Application.Ownership;
using Vessel.Messaging;
using Vessel.Messaging.Modules;
using Vessel.Messaging.Modules.Notifications;
using Vessel.Persistence;
using Vessel.Persistence.Events;
using Vessel.Persistence.Events.Subscriptions;
using Vessel.Worker;
using Wolverine;

namespace Vessel.Tests;

public sealed class NotificationOwnerTests
{
    [VesselEventPostgresFact]
    public async Task Subscription_API_counts_preferences_claims_reads_and_stream_frames_stay_in_their_owner()
    {
        await using var runtime = await Runtime.CreateAsync();
        var first = await runtime.RequestAsync(runtime.First);
        var second = await runtime.RequestAsync(runtime.Second);
        await runtime.DeliverAsync(first);
        await runtime.DeliverAsync(second);
        Assert.False(await runtime.Store.RegisterAsync(runtime.Subscription, default));
        Assert.Equal(2, await runtime.CountAsync("event_subscriptions"));
        foreach (var (owner, foreign) in new[] { (runtime.First, runtime.Second), (runtime.Second, runtime.First) })
        {
            await using var factory = new CoreApiFactory(owner, connection: runtime.Database.ConnectionString);
            using var client = factory.AuthorizedClient();
            var page = (await client.GetFromJsonAsync<NotificationPage>("/api/notifications?tab=all"))!;
            var item = Assert.Single(page.Items);
            Assert.Equal((1, 1), (page.Total, page.UnreadTotal));
            var head = (await client.GetFromJsonAsync<NotificationHeadDto>("/api/notifications/head"))!;
            Assert.Equal(1, head.UnreadCount);
            var foreignPage = await runtime.PageAsync(foreign);
            Assert.NotEqual(item.Id, Assert.Single(foreignPage.Items).Id);
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync(
                $"/api/notifications/{foreignPage.Items[0].Id}/read", null)).StatusCode);
            var cursor = head.NextCursor[..(head.NextCursor.LastIndexOf('.') + 1)] + "0";
            using (var stop = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
            using (var response = await client.GetAsync("/api/events/stream?after=0&notificationsAfter=" + cursor,
                       HttpCompletionOption.ResponseHeadersRead, stop.Token))
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(stop.Token));
                while (await reader.ReadLineAsync(stop.Token) != "event: notification") { }
                var data = (await reader.ReadLineAsync(stop.Token))!;
                Assert.StartsWith("data: ", data); // Notification frames must not set the event feed's id.
                using var json = JsonDocument.Parse(data[6..]);
                Assert.Equal(item.Id, json.RootElement.GetProperty("notification").GetProperty("id").GetGuid());
                Assert.Equal(1, json.RootElement.GetProperty("unreadCount").GetInt32());
                await stop.CancelAsync();
            }
            var claim = (await (await client.PostAsync("/api/notifications/claim", null))
                .Content.ReadFromJsonAsync<NotificationClaim>())!;
            Assert.Equal(item.Id, Assert.Single(claim.Popups).Id);
        }
        await using var firstFactory = new CoreApiFactory(runtime.First, connection: runtime.Database.ConnectionString);
        using var firstClient = firstFactory.AuthorizedClient();
        var preferences = await firstClient.PutAsJsonAsync("/api/notifications/preferences",
            new { enabled = false, minimumSeverity = "critical", categories = Array.Empty<string>(), expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, preferences.StatusCode);
        await using (var scope = runtime.Scopes.Create(runtime.Second))
            Assert.Equal((true, "info", 0L), await DefaultsAsync(scope));
        var firstHead = (await firstClient.GetFromJsonAsync<NotificationHeadDto>("/api/notifications/head"))!;
        Assert.Equal(HttpStatusCode.OK, (await firstClient.PostAsJsonAsync("/api/notifications/read", new { upTo = firstHead.NextCursor })).StatusCode);
        await using (var scope = runtime.Scopes.Create(runtime.First))
            Assert.Equal(0, (await scope.Services.GetRequiredService<NotificationService>().HeadAsync(default)).UnreadCount);
        await using (var scope = runtime.Scopes.Create(runtime.Second))
            Assert.Equal(1, (await scope.Services.GetRequiredService<NotificationService>().HeadAsync(default)).UnreadCount);
    }

    [VesselEventPostgresFact]
    public async Task Suspended_delivery_has_no_receipt_and_catches_up_after_restore_unknown_owner_dead_letters()
    {
        await using var runtime = await Runtime.CreateAsync();
        runtime.Directory.Set(runtime.First, JournalOwnerStatus.Suspended);
        var message = await runtime.RequestAsync(runtime.First);
        await runtime.DeliverAsync(message);
        Assert.Equal(0, await runtime.CountAsync("event_receipts"));
        Assert.Empty((await runtime.PageAsync(runtime.First)).Items);
        runtime.Clock.Advance(TimeSpan.FromMinutes(1));
        Assert.True(await runtime.Maintenance().RunCatchUpPassAsync(default));
        Assert.Empty((await runtime.PageAsync(runtime.First)).Items);
        runtime.Directory.Set(runtime.First, JournalOwnerStatus.Active);
        Assert.True(await runtime.Maintenance().RunCatchUpPassAsync(default));
        Assert.Single((await runtime.PageAsync(runtime.First)).Items);
        Assert.Equal(1, await runtime.CountAsync("event_receipts"));
        await Assert.ThrowsAsync<EventDeadLetterException>(() =>
            runtime.DeliverAsync(message with { OwnerId = Guid.NewGuid() }));
    }

    [VesselEventPostgresFact]
    public async Task Catch_up_isolates_an_owner_failure_and_never_beats_an_unproductive_pass()
    {
        await using var runtime = await Runtime.CreateAsync();
        await runtime.RequestAsync(runtime.First);
        await runtime.RequestAsync(runtime.Second);
        runtime.Clock.Advance(TimeSpan.FromMinutes(1));
        runtime.Directory.Checking = (owner, _) => owner == runtime.First
            ? Task.FromException(new InvalidOperationException("synthetic directory failure")) : Task.CompletedTask;
        var heartbeat = new CountingHeartbeat();
        var maintenance = runtime.Maintenance(heartbeat);
        Assert.False(await maintenance.RunCatchUpPassAsync(default));
        Assert.Equal(0, heartbeat.Beats);
        Assert.Empty((await runtime.PageAsync(runtime.First)).Items);
        Assert.Single((await runtime.PageAsync(runtime.Second)).Items);
        runtime.Directory.Checking = null;
        Assert.True(await maintenance.RunCatchUpPassAsync(default));
        Assert.Equal(1, heartbeat.Beats);
        Assert.Single((await runtime.PageAsync(runtime.First)).Items);
    }

    [VesselEventPostgresFact]
    public async Task Notification_retention_includes_suspended_owners_and_isolates_failures()
    {
        await using var runtime = await Runtime.CreateAsync();
        await runtime.DeliverAsync(await runtime.RequestAsync(runtime.First));
        await runtime.DeliverAsync(await runtime.RequestAsync(runtime.Second));
        runtime.Directory.Set(runtime.Second, JournalOwnerStatus.Suspended);
        // A third owner has only notification preferences: inventory must not depend on event cursors or users.
        var preferencesOnly = Guid.NewGuid();
        await using (var scope = runtime.Scopes.Create(preferencesOnly))
            await scope.Services.GetRequiredService<NotificationService>().SavePreferencesAsync(
                new(false, "info", [], 0), default);
        var inventory = runtime.Services.GetRequiredService<IJournalOwnerInventory>();
        Assert.Contains(preferencesOnly, await inventory.DistinctOwnersAsync(null, 100, default));
        runtime.Clock.Advance(TimeSpan.FromDays(91));
        var failing = new FailingScopes(runtime.Scopes, runtime.First);
        var retention = new NotificationRetentionService(failing, inventory, new(), runtime.Clock,
            NullLogger<NotificationRetentionService>.Instance);
        await retention.RunRetentionAsync(default);
        Assert.Single((await runtime.PageAsync(runtime.First)).Items);
        Assert.Empty((await runtime.PageAsync(runtime.Second)).Items);
        Assert.Contains(runtime.Second, failing.Attempted);
        failing.Fail = false;
        await retention.RunRetentionAsync(default);
        Assert.Empty((await runtime.PageAsync(runtime.First)).Items);
    }

    private static async Task<(bool, string, long)> DefaultsAsync(IOwnerScope scope)
    {
        var preferences = await scope.Services.GetRequiredService<NotificationService>().PreferencesAsync(default);
        return (preferences.Enabled, preferences.MinimumSeverity, preferences.Revision);
    }

    private sealed class FailingScopes(IOwnerScopeFactory inner, Guid failing) : IOwnerScopeFactory
    {
        public bool Fail { get; set; } = true;
        public List<Guid> Attempted { get; } = [];
        public IOwnerScope Create(Guid ownerId)
        {
            Attempted.Add(ownerId);
            if (Fail && ownerId == failing) throw new InvalidOperationException("synthetic scope failure");
            return inner.Create(ownerId);
        }
    }

    private sealed class CountingHeartbeat : IMaintenanceHeartbeat
    {
        public int Beats { get; private set; }
        public Task BeatAsync(CancellationToken cancellationToken) { Beats++; return Task.CompletedTask; }
    }

    internal sealed class Runtime : IAsyncDisposable
    {
        private readonly NotificationsModule module = new();
        private Runtime(CoreDatabase database)
        {
            Database = database;
            Directory.Set(First, JournalOwnerStatus.Active);
            Directory.Set(Second, JournalOwnerStatus.Active);
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Vessel"] = database.ConnectionString
            }).Build();
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddScoped<IJournalOwnerContext, AssignedOwnerContext>();
            services.AddSingleton<IJournalOwnerDirectory>(Directory);
            services.AddSingleton<TimeProvider>(Clock);
            services.AddVesselPersistence(configuration);
            services.AddVesselEvents(configuration);
            services.AddScoped<IVesselEventOutbox, NoOutbox>();
            module.AddRunningServices(services, configuration);
            Services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        }
        public Guid First { get; } = Guid.Parse("11111111-0000-0000-0000-000000000001");
        public Guid Second { get; } = Guid.Parse("22222222-0000-0000-0000-000000000002");
        public CoreDatabase Database { get; }
        public MutableOwnerDirectory Directory { get; } = new();
        public NotificationHubPostgresTests.HubClock Clock { get; } = new();
        public ServiceProvider Services { get; }
        public IOwnerScopeFactory Scopes => Services.GetRequiredService<IOwnerScopeFactory>();
        public SystemEventSubscriptionStore Store => Services.GetRequiredService<SystemEventSubscriptionStore>();
        public EventSubscription Subscription => module.Subscriptions[0];
        public static async Task<Runtime> CreateAsync()
        {
            var runtime = new Runtime(await CoreDatabase.CreateAsync());
            Assert.True(await runtime.Store.RegisterAsync(runtime.Subscription, default));
            return runtime;
        }
        public async Task<VesselEvent> RequestAsync(Guid owner)
        {
            await using var scope = Scopes.Create(owner);
            await scope.Services.GetRequiredService<NotificationService>().RequestTestAsync(default);
            return Assert.Single((await scope.Services.GetRequiredService<IVesselEventReader>().ReadAsync("0", 100, default)).Events);
        }
        public Task DeliverAsync(VesselEvent message)
        {
            var settings = new MessagingSettings();
            var registry = new VesselModuleRegistry([module]);
            var topology = new MessagingTopology(settings, registry);
            return EventSubscriptionListener.Handle(message,
                new Envelope { Destination = new Uri("rabbitmq://queue/" + topology.SubscriptionQueue(Subscription.Name)) },
                new MessagingHost("notifications", [module]), topology, Scopes, Directory,
                NullLogger<EventSubscriptionHandlerLog>.Instance, default);
        }
        public SubscriptionMaintenanceService Maintenance(params IMaintenanceHeartbeat[] heartbeats) =>
            new(new("notifications", [module]), Scopes, Directory, Store, Clock,
                NullLogger<SubscriptionMaintenanceService>.Instance, heartbeats);
        public async Task<NotificationPage> PageAsync(Guid owner)
        {
            await using var scope = Scopes.Create(owner);
            return await scope.Services.GetRequiredService<NotificationService>().PageAsync(new("all", null, null, 1, 25), default);
        }
        public async Task<long> CountAsync(string table)
        {
            // Test-only fixed table names; never supplied by an API caller.
            await using var command = Services.GetRequiredService<NpgsqlDataSource>().CreateCommand("SELECT count(*) FROM " + table);
            return (long)(await command.ExecuteScalarAsync())!;
        }
        public async ValueTask DisposeAsync()
        {
            await Services.DisposeAsync();
            await Database.DisposeAsync();
        }
    }

    private sealed class NoOutbox : IVesselEventOutbox
    {
        public Task StageAsync(VesselEvent message, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StageAsync(MonitorAccountCommand command, CancellationToken cancellationToken) => Task.CompletedTask;
        public Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public void Reset() { }
    }
}
