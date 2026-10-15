using JasperFx;
using JasperFx.CodeGeneration;
using JasperFx.Resources;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Wolverine;
using Wolverine.EntityFrameworkCore;
using Wolverine.Postgresql;
using Wolverine.RabbitMQ;
using Wolverine.Runtime;

namespace Vessel.Persistence.Events;

public sealed record PlayEventHostIdentity(string Role, string Schema, Guid OwnerId);

public static class PlayEventHosting
{
    public const string EventExchange = "vessel.events";
    public const string MonitorCommandQueue = "vessel.monitor.commands";

    public static IHostApplicationBuilder ConfigurePlayEventTransport(this IHostApplicationBuilder builder,
        IConfiguration config, string role, Action<WolverineOptions>? configure = null)
    {
        if (role is not ("api" or "worker")) throw new ArgumentException("Event host role must be api or worker.");
        var settings = config.GetSection(PlayEventSettings.Section).Get<PlayEventSettings>() ?? new();
        Validate(settings);
        if (!Uri.TryCreate(settings.RabbitMqUri, UriKind.Absolute, out var amqp) || amqp.Scheme is not ("amqp" or "amqps"))
            throw new InvalidOperationException("Vessel:Events:RabbitMqUri must configure the broker.");
        var connection = config.GetConnectionString("Vessel");
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("The event database is not configured.");
        var ownerId = config.GetValue<Guid?>("Vessel:Auth:OwnerId") ?? Guid.Parse("11111111-1111-1111-1111-111111111111");
        if (ownerId == Guid.Empty) throw new InvalidOperationException("The event owner is not configured.");
        var schema = role == "api" ? settings.ApiStorageSchema : settings.WorkerStorageSchema;
        builder.Services.AddSingleton(new PlayEventHostIdentity(role, schema, ownerId));
        builder.Services.AddPlayEvents(config);
        builder.UseWolverine(options =>
        {
            options.ServiceName = $"vessel-{role}";
            options.AutoBuildMessageStorageOnStartup = AutoCreate.None;
            options.PersistMessagesWithPostgresql(connection, schema);
            options.UseEntityFrameworkCoreTransactions();
            options.UseRuntimeCompilation();
            options.CodeGeneration.TypeLoadMode = TypeLoadMode.Dynamic;
            options.Discovery.DisableConventionalDiscovery();
            // No AutoProvision at runtime. SetupResources is the explicit storage/topology command.
            options.UseRabbitMq(amqp).UseQuorumQueues().ConfigureChannelCreation(channel =>
            {
                channel.PublisherConfirmationsEnabled = true;
                channel.PublisherConfirmationTrackingEnabled = true;
            });
            options.PublishMessage<PlayEvent>().ToRabbitTopics(EventExchange, exchange =>
            {
                foreach (var consumer in settings.DurableConsumers.Distinct(StringComparer.Ordinal))
                    exchange.BindTopic("#").ToQueue($"vessel.events.{consumer}");
            }).UseDurableOutbox();
            options.PublishMessage<MonitorAccountCommand>().ToRabbitQueue(MonitorCommandQueue).UseDurableOutbox();
            if (role == "worker")
            {
                options.Discovery.IncludeType<PlayEventReceiptHandler>();
                options.ListenToRabbitQueue("vessel.events.monitor").UseDurableInbox().MaximumParallelMessages(4);
                options.ListenToRabbitQueue(MonitorCommandQueue).UseDurableInbox().MaximumParallelMessages(4);
            }
            configure?.Invoke(options);
        });
        return builder;
    }

    public static IServiceCollection AddPlayEvents(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<PlayEventSettings>().Bind(config.GetSection(PlayEventSettings.Section))
            .Configure(s => s.MonitorInterval = config.GetValue<TimeSpan?>("Vessel:Monitor:Interval") ?? TimeSpan.FromMinutes(10))
            .Validate(s => s.MonitorInterval >= TimeSpan.FromMinutes(1) && s.MonitorInterval <= TimeSpan.FromMinutes(60),
                "Vessel:Monitor:Interval must be between 1 and 60 minutes.")
            .Validate(s => s.RetentionDays is >= 1 and <= 36500 && s.CatchupSeconds is >= 1 and <= 60,
                "Event retention and catch-up settings are invalid.")
            .Validate(s => ValidConsumers(s.DurableConsumers), "Durable event consumers are invalid.").ValidateOnStart();
        services.AddOptions<PlayEventSettings>()
            .Validate(s => PlayEventSettings.ValidSchema(s.ApiStorageSchema) &&
                PlayEventSettings.ValidSchema(s.WorkerStorageSchema) && s.ApiStorageSchema != s.WorkerStorageSchema,
                "Event API and worker storage schemas must be distinct safe PostgreSQL identifiers.");
        services.TryAddScoped<PlayEventMutationCapture>();
        services.TryAddScoped<IPlayEventOutbox, WolverinePlayEventOutbox>();
        services.TryAddScoped<PlayEventStore>();
        services.TryAddScoped<IPlayEventSink>(sp => sp.GetRequiredService<PlayEventStore>());
        services.TryAddScoped<IPlayEventReader, PlayEventHistory>();
        services.TryAddScoped<IMonitorCommandSink>(sp => sp.GetRequiredService<PlayEventStore>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IUnitOfWorkParticipant, PlayEventUnitOfWorkParticipant>());
        services.TryAddScoped<PlayEventRetention>();
        services.TryAddScoped<PlayEventRecovery>();
        // Attaches to the existing context registration. No separate context/outbox mappings or EF upgrade.
        services.ConfigureDbContext<VesselDbContext>((sp, options) =>
            options.AddInterceptors(sp.GetRequiredService<PlayEventMutationCapture>()));
        return services;
    }

    public static async Task ProvisionPlayEventTransportAsync(this IHost host, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // Provision api and worker schemas separately by building each role; no EF migrations run here.
        await host.SetupResources();
    }

    private static bool ValidConsumers(string[]? consumers) => consumers is { Length: >= 1 and <= 20 } &&
        consumers.Contains("monitor", StringComparer.Ordinal) && consumers.Distinct(StringComparer.Ordinal).Count() == consumers.Length &&
        consumers.All(c => c.Length is >= 1 and <= 64 && c.All(ch => char.IsAsciiLetterLower(ch) || char.IsAsciiDigit(ch) || ch == '-'));

    private static void Validate(PlayEventSettings settings)
    {
        if (settings.RetentionDays is < 1 or > 36500 || settings.CatchupSeconds is < 1 or > 60 ||
            !ValidConsumers(settings.DurableConsumers) || !PlayEventSettings.ValidSchema(settings.ApiStorageSchema) ||
            !PlayEventSettings.ValidSchema(settings.WorkerStorageSchema) || settings.ApiStorageSchema == settings.WorkerStorageSchema)
            throw new InvalidOperationException("Invalid Play event settings.");
    }
}

// Resolve the same scoped sink as Application uses. UoW construction does not resolve its DbContext twice.
internal sealed class PlayEventUnitOfWorkParticipant(PlayEventStore store) : IUnitOfWorkParticipant
{
    public Task BeforeCommitAsync(CancellationToken ct) => store.BeforeCommitAsync(ct);
    public Task AfterCommitAsync(CancellationToken ct) => store.AfterCommitAsync(ct);
    public Task RollbackAsync(CancellationToken ct) => store.RollbackAsync(ct);
}
