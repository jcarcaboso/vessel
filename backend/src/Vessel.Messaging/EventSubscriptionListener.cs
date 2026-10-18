using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vessel.Application.Events;
using Vessel.Application.Ownership;
using Vessel.Messaging.Modules;
using Vessel.Persistence.Events.Subscriptions;
using Wolverine;

namespace Vessel.Messaging;

/// <summary>Dead-letters the current delivery through the queue's own dead-letter exchange.</summary>
public sealed class EventDeadLetterException(DispatchOutcome outcome)
    : Exception($"Event delivery dead-lettered: {outcome}.")
{
    public DispatchOutcome Outcome { get; } = outcome;
}

/// <summary>Dead-letters the current command delivery through the queue's own dead-letter exchange.</summary>
public sealed class CommandDeadLetterException(string reason) : Exception($"Command delivery dead-lettered: {reason}.");

/// <summary>
/// The inline listener behind every subscription queue. It acknowledges once the dispatcher has settled or recorded
/// the attempt; only terminal failures, invalid owners and unknown events are dead-lettered. Catch-up from
/// PostgreSQL owns retries, so an infrastructure failure here is acknowledged rather than requeued.
/// </summary>
public sealed class EventSubscriptionListener
{
    public static async Task Handle(VesselEvent message, Envelope envelope, MessagingHost host, MessagingTopology topology,
        IOwnerScopeFactory scopes, IJournalOwnerDirectory owners, ILogger<EventSubscriptionHandlerLog> logger,
        CancellationToken cancellationToken)
    {
        var name = topology.SubscriptionAt(envelope.Destination);
        var subscription = host.RunningSubscriptions.SingleOrDefault(s => s.Name == name);
        if (subscription is null)
        {
            logger.LogWarning("Event {EventId} arrived on a queue this host does not run; dead-lettering.", message.Id);
            throw new EventDeadLetterException(DispatchOutcome.NotResponsible);
        }
        DispatchResult result;
        try
        {
            var status = await owners.StatusAsync(message.OwnerId, cancellationToken);
            if (status == JournalOwnerStatus.Suspended) return;
            if (status != JournalOwnerStatus.Active)
            {
                logger.LogWarning("Event {EventId} for subscription {Subscription} names unknown owner {OwnerId}; dead-lettering.",
                    message.Id, subscription.Name, message.OwnerId);
                throw new EventDeadLetterException(DispatchOutcome.InvalidOwner);
            }
            await using var scope = scopes.Create(message.OwnerId);
            result = await scope.Services.GetRequiredService<EventDispatcher>()
                .DispatchAsync(subscription, message.OwnerId, message.Id, DispatchTrigger.Live, cancellationToken);
        }
        catch (Exception error) when (error is not EventDeadLetterException)
        {
            // Including shutdown: the receipt (or its absence) is in PostgreSQL, so an ack loses nothing.
            logger.LogWarning("Event {EventId} for subscription {Subscription} was acknowledged after {ErrorType}; catch-up retries it.",
                message.Id, subscription.Name, error.GetType().Name);
            return;
        }
        if (result.DeadLetter)
        {
            logger.LogWarning("Event {EventId} for subscription {Subscription} is dead-lettered ({Outcome}).",
                message.Id, subscription.Name, result.Outcome);
            throw new EventDeadLetterException(result.Outcome);
        }
    }
}

/// <summary>Log category for subscription deliveries; logs carry IDs and type names only.</summary>
public sealed class EventSubscriptionHandlerLog;
