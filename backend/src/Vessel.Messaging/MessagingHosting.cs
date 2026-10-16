using JasperFx;
using JasperFx.CodeGeneration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Ownership;
using Vessel.Messaging.Modules;
using Vessel.Persistence.Events;
using Vessel.Persistence.Events.Subscriptions;
using Wolverine;
using Wolverine.EntityFrameworkCore;
using Wolverine.ErrorHandling;
using Wolverine.Postgresql;
using Wolverine.RabbitMQ;
using Vessel.Application.Events;

namespace Vessel.Messaging;

/// <summary>What this process is: its logical deployment, the configured owner and the modules it runs.</summary>
public sealed record MessagingHost(string Deployment, Guid OwnerId, IReadOnlyList<IVesselModule> RunningModules)
{
    public IReadOnlyList<EventSubscription> RunningSubscriptions { get; } = RunningModules.SelectMany(m => m.Subscriptions).ToArray();
}

public static class MessagingHosting
{
    public const string ApiDeployment = "api";

    public static MessagingSettings Settings(IConfiguration configuration)
    {
        // A fresh instance per read: binding never appends to a populated default collection.
        var settings = new MessagingSettings();
        configuration.GetSection(MessagingSettings.Section).Bind(settings);
        return settings;
    }

    /// <summary>
    /// Adds the transport for one logical deployment: its own envelope schema, durable publication of events and of
    /// every module's commands, and inline listeners only for the modules it runs. Nothing is declared at runtime.
    /// </summary>
    /// <param name="registry">The compiled-in registry by default; tests may supply test-only modules.</param>
    public static IHostApplicationBuilder AddVesselMessaging(this IHostApplicationBuilder builder, string deployment,
        IEnumerable<string>? runModules = null, Action<WolverineOptions>? configure = null, VesselModuleRegistry? registry = null)
    {
        var settings = Settings(builder.Configuration);
        settings.Validate();
        if (!MessagingNames.ValidName(deployment)) throw new InvalidOperationException("Invalid messaging deployment name.");
        var connection = builder.Configuration.GetConnectionString("Vessel");
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("The event database is not configured.");
        registry ??= VesselModuleRegistry.From(settings);
        var host = new MessagingHost(deployment, JournalOwner.Parse(builder.Configuration[JournalOwner.ConfigurationKey]),
            registry.Select(runModules ?? []));
        var topology = new MessagingTopology(settings, registry);
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton(registry);
        builder.Services.AddSingleton(topology);
        builder.Services.AddSingleton(host);
        builder.Services.AddVesselEvents(builder.Configuration);
        builder.Services.Replace(ServiceDescriptor.Scoped<IVesselEventOutbox, WolverineVesselEventOutbox>());
        foreach (var module in host.RunningModules) module.AddRunningServices(builder.Services, builder.Configuration);
        // Registered before Wolverine, so it runs first: never recover envelopes from a schema provisioned for others.
        builder.Services.AddHostedService<MessagingDeploymentGuard>();
        builder.UseWolverine(options =>
        {
            Configure(options, settings, connection, deployment);
            options.UseRabbitMq(settings.BrokerUri()).UseQuorumQueues().DisableDeadLetterQueueing()
                .ConfigureChannelCreation(channel =>
                {
                    channel.PublisherConfirmationsEnabled = true;
                    channel.PublisherConfirmationTrackingEnabled = true;
                });
            // Publish once to the topic, routing key = type. No knowledge of who listens.
            options.PublishMessage<VesselEvent>().ToRabbitTopics(topology.EventExchange).UseDurableOutbox();
            foreach (var command in registry.Modules.SelectMany(m => m.Commands))
                options.PublishMessage(command.MessageType)
                    .ToRabbitQueue(topology.CommandQueue(command.Name), queue => topology.Configure(queue, topology.CommandQueue(command.Name)))
                    .UseDurableOutbox();
            foreach (var subscription in host.RunningSubscriptions)
            {
                var queue = topology.SubscriptionQueue(subscription.Name);
                // Inline, not the durable inbox: the delivery is acknowledged only after the receipt settles.
                options.ListenToRabbitQueue(queue, q => topology.Configure(q, queue)).ProcessInline();
            }
            if (host.RunningSubscriptions.Count != 0) options.Discovery.IncludeType(typeof(EventSubscriptionListener));
            foreach (var command in host.RunningModules.SelectMany(m => m.Commands).Where(c => c.Handler is not null))
            {
                var queue = topology.CommandQueue(command.Name);
                options.ListenToRabbitQueue(queue, q => topology.Configure(q, queue)).ProcessInline();
                options.Discovery.IncludeType(command.Handler!);
            }
            options.Policies.OnException<EventDeadLetterException>().MoveToErrorQueue();
            options.Policies.OnException<CommandDeadLetterException>().MoveToErrorQueue();
            configure?.Invoke(options);
        });
        return builder;
    }

    /// <summary>Catch-up and retention sweeps. Worker hosts register this; the API never does.</summary>
    public static IServiceCollection AddSubscriptionMaintenance(this IServiceCollection services) =>
        services.AddHostedService<SubscriptionMaintenanceService>();

    /// <summary>Envelope storage and code generation shared by runtime and provisioning hosts.</summary>
    internal static void Configure(WolverineOptions options, MessagingSettings settings, string connection, string deployment)
    {
        options.ServiceName = $"vessel-{deployment}";
        // Runtime never creates storage; the explicit provision step does.
        options.AutoBuildMessageStorageOnStartup = AutoCreate.None;
        options.PersistMessagesWithPostgresql(connection, settings.SchemaFor(deployment));
        options.UseEntityFrameworkCoreTransactions();
        options.UseRuntimeCompilation();
        options.CodeGeneration.TypeLoadMode = TypeLoadMode.Dynamic;
        options.Discovery.DisableConventionalDiscovery();
        // The event serialization policy on the wire too: web casing and explicit nulls.
        options.UseSystemTextJsonForSerialization(json =>
        {
            json.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
            json.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never;
        });
    }
}
