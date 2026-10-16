using RabbitMQ.Client;
using Wolverine.RabbitMQ;
using Vessel.Messaging.Modules;

namespace Vessel.Messaging;

/// <summary>
/// Broker names and declarations. Runtime hosts never declare anything; only the explicit provision step
/// declares the topic, every module's subscription and command queues, their dead-letter exchanges and queues.
/// </summary>
public sealed class MessagingTopology(MessagingSettings settings, VesselModuleRegistry registry)
{
    private const string QueuePrefix = "rabbitmq://queue/";

    public string EventExchange => $"{settings.Prefix}.events";
    public string SubscriptionQueue(string subscription) => $"{settings.Prefix}.events.sub.{subscription}";
    public string CommandQueue(string name) => $"{settings.Prefix}.commands.{name}";
    public static string DeadLetterExchange(string queue) => queue + ".dlx";
    public static string DeadLetterQueue(string queue) => queue + ".dlq";

    /// <summary>The subscription whose queue delivered a message, from the inline listener's address.</summary>
    public string? SubscriptionAt(Uri? destination)
    {
        var address = destination?.ToString();
        if (address is null || !address.StartsWith(QueuePrefix, StringComparison.Ordinal)) return null;
        var queue = address[QueuePrefix.Length..].TrimEnd('/');
        return registry.Modules.SelectMany(m => m.Subscriptions).Select(s => s.Name)
            .SingleOrDefault(name => SubscriptionQueue(name) == queue);
    }

    /// <summary>Durable quorum queue that dead-letters to its own exchange, with the transport delivery guard.</summary>
    public Dictionary<string, object?> QueueArguments(string queue) => new(StringComparer.Ordinal)
    {
        ["x-queue-type"] = "quorum",
        ["x-delivery-limit"] = settings.DeliveryLimit,
        ["x-dead-letter-exchange"] = DeadLetterExchange(queue)
    };

    /// <summary>Wolverine's view of a queue matches what provisioning declared, so it nacks into the same dead-letter path.</summary>
    internal void Configure(IRabbitMqQueue queue, string name)
    {
        queue.QueueType = Wolverine.RabbitMQ.Internal.QueueType.quorum;
        foreach (var (key, value) in QueueArguments(name)) queue.Arguments[key] = value;
        if (queue is Wolverine.RabbitMQ.Internal.RabbitMqQueue concrete)
            concrete.DeadLetterQueue = new(DeadLetterQueue(name), DeadLetterQueueMode.Native) { ExchangeName = DeadLetterExchange(name) };
    }

    /// <summary>Declares the full topology of every known module. An existing queue with other arguments fails provisioning.</summary>
    public async Task DeclareAsync(CancellationToken cancellationToken)
    {
        var factory = new ConnectionFactory { Uri = settings.BrokerUri(), ClientProvidedName = "vessel-provision" };
        await using var connection = await factory.CreateConnectionAsync(cancellationToken);
        await using var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);
        await channel.ExchangeDeclareAsync(EventExchange, RabbitMQ.Client.ExchangeType.Topic, durable: true, autoDelete: false,
            cancellationToken: cancellationToken);
        foreach (var subscription in registry.Modules.SelectMany(m => m.Subscriptions))
        {
            var queue = SubscriptionQueue(subscription.Name);
            await DeclareQueueAsync(channel, queue, cancellationToken);
            foreach (var filter in subscription.Filters)
                await channel.QueueBindAsync(queue, EventExchange, filter, cancellationToken: cancellationToken);
        }
        foreach (var command in registry.Modules.SelectMany(m => m.Commands))
            await DeclareQueueAsync(channel, CommandQueue(command.Name), cancellationToken);
    }

    /// <summary>Deletes a deregistered subscription's queue, bindings and dead-letter path, so the topic stops routing to it.</summary>
    public async Task DeleteSubscriptionQueueAsync(string subscription, CancellationToken cancellationToken)
    {
        var factory = new ConnectionFactory { Uri = settings.BrokerUri(), ClientProvidedName = "vessel-provision" };
        await using var connection = await factory.CreateConnectionAsync(cancellationToken);
        await using var channel = await connection.CreateChannelAsync(cancellationToken: cancellationToken);
        var queue = SubscriptionQueue(subscription);
        await channel.QueueDeleteAsync(queue, ifUnused: false, ifEmpty: false, cancellationToken: cancellationToken);
        await channel.QueueDeleteAsync(DeadLetterQueue(queue), ifUnused: false, ifEmpty: false, cancellationToken: cancellationToken);
        await channel.ExchangeDeleteAsync(DeadLetterExchange(queue), ifUnused: false, cancellationToken: cancellationToken);
    }

    private async Task DeclareQueueAsync(IChannel channel, string queue, CancellationToken cancellationToken)
    {
        var deadLetters = DeadLetterExchange(queue);
        await channel.ExchangeDeclareAsync(deadLetters, RabbitMQ.Client.ExchangeType.Fanout, durable: true, autoDelete: false,
            cancellationToken: cancellationToken);
        await channel.QueueDeclareAsync(DeadLetterQueue(queue), durable: true, exclusive: false, autoDelete: false,
            arguments: new Dictionary<string, object?> { ["x-queue-type"] = "quorum" }, cancellationToken: cancellationToken);
        await channel.QueueBindAsync(DeadLetterQueue(queue), deadLetters, "", cancellationToken: cancellationToken);
        await channel.QueueDeclareAsync(queue, durable: true, exclusive: false, autoDelete: false,
            arguments: QueueArguments(queue), cancellationToken: cancellationToken);
    }
}
