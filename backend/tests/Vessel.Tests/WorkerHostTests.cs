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

    private static IHost Worker(BrokerScope broker, string module, string? deployment = null)
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
        WorkerHost.Configure(builder);
        return builder.Build();
    }

    private static IConfiguration Configuration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
