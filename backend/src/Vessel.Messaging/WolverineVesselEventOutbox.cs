using Vessel.Application.Events;
using Vessel.Persistence;
using Vessel.Persistence.Events;
using Wolverine;
using Wolverine.EntityFrameworkCore;
using Wolverine.Runtime;

namespace Vessel.Messaging;

/// <summary>
/// Wolverine's durable outbox at the unit-of-work boundary: envelopes are written on the context's own transaction
/// while the unit is active and flushed only after the outer commit. Publishers know nothing about subscribers.
/// </summary>
public sealed class WolverineVesselEventOutbox(VesselDbContext db, IWolverineRuntime runtime, MessagingHost host)
    : IVesselEventOutbox
{
    private DbContextOutbox<VesselDbContext>? current;

    private DbContextOutbox<VesselDbContext> Outbox()
    {
        UnitOfWorkParticipation.RequireActive(db);
        // Fresh per outer transaction. Never reuse a rolled-back message context in the same request scope.
        return current ??= new DbContextOutbox<VesselDbContext>(runtime, db, []);
    }

    public Task StageAsync(VesselEvent message, CancellationToken cancellationToken) =>
        UnitOfWorkParticipation.RunAsync(db, async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            // One publication; the routing key is the event type. Subscriptions bind their own filters.
            await Outbox().BroadcastToTopicAsync(message.Type, message,
                new DeliveryOptions { CorrelationId = message.Id.ToString() });
            return true;
        }, cancellationToken);

    public Task StageAsync(MonitorAccountCommand command, CancellationToken cancellationToken)
    {
        // A consuming host has no durable route to its own command queue. Refusing here rolls the unit back rather
        // than letting Wolverine choose some other route for the command.
        if (host.Consumes(typeof(MonitorAccountCommand)))
            throw new InvalidOperationException($"Deployment '{host.Deployment}' consumes monitor commands and cannot publish them.");
        return UnitOfWorkParticipation.RunAsync(db, async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Outbox().SendAsync(command);
            return true;
        }, cancellationToken);
    }

    public async Task FlushAsync(CancellationToken cancellationToken)
    {
        if (current is null) return;
        // EF keeps CurrentTransaction until it is disposed, even after CommitAsync. The caller owns that boundary.
        await current.FlushOutgoingMessagesAsync();
    }

    public void Reset() => current = null;
}
