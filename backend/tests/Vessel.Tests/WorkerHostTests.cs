using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Events;
using Vessel.Messaging;
using Vessel.Messaging.Modules.Monitor;
using Vessel.Messaging.Modules.Verification;
using Vessel.Worker;
using Wolverine;
using Wolverine.Configuration;
using Wolverine.Runtime;
using Wolverine.Runtime.Routing;

namespace Vessel.Tests;

public sealed class WorkerHostTests
{
    [Fact]
    public void Worker_runs_the_monitor_module_by_default_in_its_own_deployment()
    {
        var settings = WorkerSettings.From(new ConfigurationBuilder().Build());
        Assert.Equal([MonitorModule.ModuleName], settings.Modules);
        Assert.Equal(MonitorModule.ModuleName, settings.Deployment);
        var configured = WorkerSettings.From(Configuration(new()
        {
            ["Vessel:Worker:Modules:0"] = "verification", ["Vessel:Worker:Deployment"] = "checks"
        }));
        Assert.Equal(["verification"], configured.Modules);
        Assert.Equal("checks", configured.Deployment);
        Assert.Throws<InvalidOperationException>(() => WorkerSettings.From(Configuration(new() { ["Vessel:Worker:Deployment"] = "api" })));
    }

    [Fact]
    public void An_unknown_worker_module_stops_startup()
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { DisableDefaults = true });
        builder.Configuration.AddConfiguration(Configuration(new()
        {
            ["Vessel:Worker:Modules:0"] = "notifications",
            ["Vessel:Messaging:RabbitMqUri"] = "amqp://unused:unused@127.0.0.1:1",
            ["ConnectionStrings:Vessel"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused"
        }));
        var error = Assert.Throws<InvalidOperationException>(() => WorkerHost.Configure(builder));
        Assert.Contains("Unknown messaging module", error.Message);
    }

    [Fact]
    public void Provisioning_knows_every_deployment_and_its_module_set()
    {
        var settings = new MessagingSettings { Verification = true };
        var registry = Vessel.Messaging.Modules.VesselModuleRegistry.From(settings);
        var defaults = settings.DeploymentModules(registry);
        Assert.Equal(["api", "monitor", "verification"], defaults.Keys);
        Assert.Empty(defaults["api"]);
        Assert.Equal(["monitor"], defaults["monitor"]);
        settings.Deployments["monitor"] = ["verification", "monitor"];
        Assert.Equal(["monitor", "verification"], settings.DeploymentModules(registry)["monitor"]);
        settings.Deployments["monitor"] = ["notifications"];
        Assert.Throws<InvalidOperationException>(() => settings.DeploymentModules(registry));
        settings.Deployments.Clear();
        settings.Deployments["api"] = ["monitor"];
        Assert.Throws<InvalidOperationException>(() => settings.DeploymentModules(registry));
    }

    [VesselEventRabbitFact]
    public async Task Startup_rejects_a_schema_provisioned_for_another_module_set()
    {
        await using var broker = await BrokerScope.CreateAsync();
        // Not provisioned yet: no deployment may start, and no schema is created at runtime.
        using (var early = Worker(broker, MonitorModule.ModuleName))
            await Assert.ThrowsAnyAsync<InvalidOperationException>(() => early.StartAsync());
        await broker.ProvisionAsync();
        // The monitor schema was provisioned for ["monitor"]; a host running other modules in it must not start.
        using (var wrong = Worker(broker, VerificationModule.ModuleName, deployment: MonitorModule.ModuleName))
            await Assert.ThrowsAnyAsync<InvalidOperationException>(() => wrong.StartAsync());
        // Changing a deployment's module set at provisioning is rejected too, until its schema is drained.
        var changed = new ConfigurationBuilder().AddConfiguration(broker.Configuration).AddInMemoryCollection(
            new Dictionary<string, string?> { ["Vessel:Messaging:Deployments:monitor:0"] = VerificationModule.ModuleName }).Build();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            MessagingProvisioning.ProvisionAsync(changed, default, broker.Registry));
        Assert.Contains("another deployment or module set", error.Message);
        using var worker = Worker(broker, MonitorModule.ModuleName);
        await worker.StartAsync();
        await worker.StopAsync();
    }

    [VesselEventRabbitFact]
    public async Task Owner_mismatched_monitor_command_is_dead_lettered_not_acknowledged()
    {
        await using var broker = await BrokerScope.CreateAsync();
        await broker.ProvisionAsync();
        var api = await broker.StartAsync(MessagingHosting.ApiDeployment);
        using var worker = Worker(broker, MonitorModule.ModuleName);
        await worker.StartAsync();
        var bus = api.Services.GetRequiredService<IMessageBus>();
        var queue = broker.Topology.CommandQueue(MonitorModule.ModuleName);
        await bus.SendAsync(new MonitorAccountCommand(Guid.CreateVersion7(), Guid.NewGuid(), Guid.NewGuid(), "manual"));
        await broker.EventuallyAsync(async () => await broker.ReadyAsync(MessagingTopology.DeadLetterQueue(queue)) == 1);
        // A command for the configured owner without a matching pending request is acknowledged: the record is
        // monitor_accounts, and the listener never polls a venue.
        await bus.SendAsync(new MonitorAccountCommand(Guid.CreateVersion7(), Guid.NewGuid(), broker.Owner, "manual"));
        await Task.Delay(1000);
        await worker.StopAsync();
        Assert.Equal(0u, await broker.ReadyAsync(queue));
        Assert.Equal(1u, await broker.ReadyAsync(MessagingTopology.DeadLetterQueue(queue)));
    }

    [VesselEventRabbitFact]
    public async Task Command_queue_is_published_durably_by_the_api_and_listened_inline_by_its_module()
    {
        await using var broker = await BrokerScope.CreateAsync();
        await broker.ProvisionAsync();
        var logs = new StartupLogs();
        var api = broker.Build(MessagingHosting.ApiDeployment, [], logs);
        await api.StartAsync();
        using var worker = Worker(broker, MonitorModule.ModuleName, logs: logs);
        await worker.StartAsync();
        var queue = new Uri($"rabbitmq://queue/{broker.Topology.CommandQueue(MonitorModule.ModuleName)}");

        // The API only publishes: through the durable outbox, never inline.
        var published = Endpoint(api, queue);
        Assert.False(published.IsListener);
        Assert.Equal(EndpointMode.Durable, published.Mode);
        Assert.Contains(Routes(api), route => route == queue);

        // The worker only listens, inline, so a delivery is acknowledged after the handler settles. It declares no
        // publishing side for the same endpoint, so no second mode request can replace this one.
        var listened = Endpoint(worker, queue);
        Assert.True(listened.IsListener);
        Assert.Equal(EndpointMode.Inline, listened.Mode);
        Assert.DoesNotContain(Routes(worker), route => route == queue);
        // Nothing in the worker may stage the command it consumes: it would bypass the API's durable outbox.
        await using (var scope = worker.Services.CreateAsyncScope())
        {
            var outbox = scope.ServiceProvider.GetRequiredService<Vessel.Persistence.Events.IVesselEventOutbox>();
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
                outbox.StageAsync(new MonitorAccountCommand(Guid.CreateVersion7(), Guid.NewGuid(), broker.Owner, "manual"), default));
            Assert.Contains("consumes", error.Message);
        }
        await worker.StopAsync();
        await api.StopAsync();

        // Wolverine validates every listener at startup and warns when both sides asked for different modes.
        Assert.Contains(logs.Messages, m => m.Category.StartsWith("Wolverine", StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Messages, m => m.Text.Contains("Conflicting endpoint mode", StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Messages, m => m.Level >= LogLevel.Warning && m.Text.Contains("commands.", StringComparison.Ordinal));
    }

    [PostgresFact]
    public async Task Review_M2_heartbeat_advances_only_after_a_productive_scheduling_pass()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var file = Path.Combine(Path.GetTempPath(), "vessel-heartbeat-" + Guid.NewGuid().ToString("N"));
        try
        {
            using (var healthy = Scheduler(database.ConnectionString, owner, file, out var scheduler))
            {
                await scheduler.TickAsync(default);
                var parts = (await File.ReadAllTextAsync(file)).Split(' ');
                Assert.Equal(2, parts.Length);
                Assert.Equal("90", parts[1]);
                await using var db = database.Context(owner);
                Assert.NotNull(await new Vessel.Persistence.MonitorStore(db, TestUnitOfWork.For(db)).HeartbeatAsync(default));
            }
            // Discovery cannot run: the pass is not productive, so neither heartbeat advances.
            await File.WriteAllTextAsync(file, "1 90");
            using (var broken = Scheduler("Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused", owner, file, out var scheduler))
                await Assert.ThrowsAnyAsync<Exception>(() => scheduler.TickAsync(default));
            Assert.Equal("1 90", await File.ReadAllTextAsync(file));
            // The heartbeat file cannot be written: the database heartbeat is not recorded either.
            var other = Guid.NewGuid();
            var missing = Path.Combine(Path.GetTempPath(), "vessel-missing-" + Guid.NewGuid().ToString("N"), "heartbeat");
            using (var unwritable = Scheduler(database.ConnectionString, other, missing, out var scheduler))
                await Assert.ThrowsAnyAsync<IOException>(() => scheduler.TickAsync(default));
            await using var foreign = database.Context(other);
            Assert.Null(await new Vessel.Persistence.MonitorStore(foreign, TestUnitOfWork.For(foreign)).HeartbeatAsync(default));
        }
        finally { File.Delete(file); }
    }

    private static IHost Scheduler(string connection, Guid owner, string file, out MonitorScheduler scheduler)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { DisableDefaults = true });
        builder.Configuration.AddConfiguration(Configuration(new()
        {
            ["ConnectionStrings:Vessel"] = connection,
            ["Vessel:Auth:OwnerId"] = owner.ToString(),
            ["Vessel:Messaging:RabbitMqUri"] = "amqp://unused:unused@127.0.0.1:1",
            ["Vessel:Monitor:HeartbeatFile"] = file
        }));
        builder.Logging.ClearProviders();
        WorkerHost.Configure(builder);
        VesselEventTestHosting.ConfigureServices(builder.Services);
        var host = builder.Build();
        scheduler = host.Services.GetServices<IHostedService>().OfType<MonitorScheduler>().Single();
        return host;
    }

    private static Wolverine.Configuration.Endpoint Endpoint(IHost host, Uri uri) =>
        host.Services.GetRequiredService<IWolverineRuntime>().Options.Transports.TryGetEndpoint(uri)
        ?? throw new InvalidOperationException($"No endpoint {uri}.");

    private static Uri[] Routes(IHost host) => host.Services.GetRequiredService<IWolverineRuntime>()
        .RoutingFor(typeof(MonitorAccountCommand)).Routes.OfType<MessageRoute>().Select(r => r.Uri).ToArray();

    private static IHost Worker(BrokerScope broker, string module, string? deployment = null, ILoggerProvider? logs = null)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { DisableDefaults = true });
        builder.Configuration.AddConfiguration(broker.Configuration);
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Vessel:Messaging:Verification"] = "true",
            ["Vessel:Worker:Modules:0"] = module,
            ["Vessel:Worker:Deployment"] = deployment ?? module,
            ["Vessel:Monitor:HeartbeatFile"] = Path.Combine(Path.GetTempPath(), "vessel-worker-test-" + Guid.NewGuid().ToString("N"))
        });
        builder.Logging.ClearProviders();
        if (logs is not null) builder.Logging.AddProvider(logs);
        WorkerHost.Configure(builder);
        return builder.Build();
    }

    private sealed class StartupLogs : ILoggerProvider
    {
        private readonly List<(string Category, LogLevel Level, string Text)> messages = [];
        public IReadOnlyList<(string Category, LogLevel Level, string Text)> Messages { get { lock (messages) return messages.ToArray(); } }
        public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);
        public void Dispose() { }

        private sealed class Logger(StartupLogs logs, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (logs.messages) logs.messages.Add((category, logLevel, formatter(state, exception)));
            }
        }
    }

    private static IConfiguration Configuration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
