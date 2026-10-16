using JasperFx.Resources;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Ownership;
using Vessel.Messaging.Modules;
using Vessel.Persistence;
using Vessel.Persistence.Events;
using Vessel.Persistence.Events.Subscriptions;
using Wolverine;

namespace Vessel.Messaging;

public sealed record ProvisioningResult(IReadOnlyList<string> Schemas, IReadOnlyList<string> Registered, IReadOnlyList<string> Existing);

/// <summary>
/// The explicit provision step, run after the EF migrations and never at runtime: envelope storage and the schema
/// registration of every configured logical deployment, the broker topology of every known module, then insert-only subscription registrations.
/// </summary>
public static class MessagingProvisioning
{
    public static async Task<ProvisioningResult> ProvisionAsync(IConfiguration configuration, CancellationToken cancellationToken,
        VesselModuleRegistry? registry = null)
    {
        var settings = MessagingHosting.Settings(configuration);
        settings.Validate();
        var connection = configuration.GetConnectionString("Vessel");
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("The event database is not configured.");
        registry ??= VesselModuleRegistry.From(settings);
        var deployments = settings.DeploymentModules(registry);
        var schemas = deployments.Keys.Select(settings.SchemaFor).ToArray();
        if (schemas.Distinct(StringComparer.Ordinal).Count() != schemas.Length)
            throw new InvalidOperationException("Every logical deployment needs its own envelope schema.");
        foreach (var (deployment, modules) in deployments)
        {
            // Storage only: no transport, so nothing about the broker is inferred from Wolverine's endpoint model.
            var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { DisableDefaults = true });
            builder.Logging.ClearProviders();
            builder.UseWolverine(options => MessagingHosting.Configure(options, settings, connection, deployment));
            using var host = builder.Build();
            await host.SetupResources();
            await MessagingDeployments.RegisterAsync(connection, settings.SchemaFor(deployment), deployment, modules, cancellationToken);
        }
        // Registration first: a changed filter is rejected before any new binding reaches the broker.
        var registered = new List<string>();
        var existing = new List<string>();
        await using (var provider = RegistrationServices(configuration))
        {
            foreach (var subscription in registry.Modules.SelectMany(m => m.Subscriptions))
            {
                await using var scope = provider.CreateAsyncScope();
                var created = await scope.ServiceProvider.GetRequiredService<EventSubscriptionRegistry>()
                    .RegisterAsync(subscription, cancellationToken);
                (created ? registered : existing).Add(subscription.Name);
            }
        }
        await new MessagingTopology(settings, registry).DeclareAsync(cancellationToken);
        return new(schemas, registered, existing);
    }

    /// <summary>Removes a subscription's registration, receipts and queue, releasing what it held.</summary>
    public static async Task<bool> DeregisterAsync(IConfiguration configuration, string subscription, CancellationToken cancellationToken,
        VesselModuleRegistry? registry = null)
    {
        var settings = MessagingHosting.Settings(configuration);
        settings.Validate();
        registry ??= VesselModuleRegistry.From(settings);
        bool removed;
        await using (var provider = RegistrationServices(configuration))
        await using (var scope = provider.CreateAsyncScope())
            removed = await scope.ServiceProvider.GetRequiredService<EventSubscriptionRegistry>().DeregisterAsync(subscription, cancellationToken);
        await new MessagingTopology(settings, registry).DeleteSubscriptionQueueAsync(subscription, cancellationToken);
        return removed;
    }

    /// <summary>The bounded admin retry for a compiled-in subscription's failed receipts.</summary>
    public static async Task<int> RetryFailedAsync(IConfiguration configuration, string subscription, int limit, int extraAttempts,
        CancellationToken cancellationToken)
    {
        var settings = MessagingHosting.Settings(configuration);
        var definition = VesselModuleRegistry.From(settings).Modules.SelectMany(m => m.Subscriptions)
            .SingleOrDefault(s => s.Name == subscription) ?? throw new InvalidOperationException("Unknown subscription.");
        await using var provider = RegistrationServices(configuration);
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<EventReceiptAdmin>()
            .RetryFailedAsync(definition, limit, extraAttempts, cancellationToken);
    }

    private static ServiceProvider RegistrationServices(IConfiguration configuration)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IJournalOwnerContext>(new ConfiguredOwner(JournalOwner.Parse(configuration[JournalOwner.ConfigurationKey])));
        services.AddVesselPersistence(configuration);
        services.AddVesselEvents(configuration);
        // Registration and admin paths append no events; nothing is published from here.
        services.AddScoped<IVesselEventOutbox, NoPublication>();
        return services.BuildServiceProvider();
    }

    private sealed record ConfiguredOwner(Guid OwnerId) : IJournalOwnerContext;

    private sealed class NoPublication : IVesselEventOutbox
    {
        public Task StageAsync(Vessel.Application.Events.VesselEvent message, CancellationToken ct) =>
            throw new InvalidOperationException("Provisioning never publishes events.");
        public Task StageAsync(Vessel.Application.Events.MonitorAccountCommand command, CancellationToken ct) =>
            throw new InvalidOperationException("Provisioning never sends commands.");
        public Task FlushAsync(CancellationToken ct) => Task.CompletedTask;
        public void Reset() { }
    }
}
