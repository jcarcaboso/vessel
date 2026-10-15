using Microsoft.EntityFrameworkCore;
using Vessel.Application.Events;
using Wolverine;
using Wolverine.EntityFrameworkCore;
using Wolverine.Runtime;

namespace Vessel.Persistence.Events;

public sealed class WolverinePlayEventOutbox(VesselDbContext db, IWolverineRuntime runtime, PlayEventHostIdentity host)
    : IPlayEventOutbox
{
    private DbContextOutbox<VesselDbContext>? current;

    private DbContextOutbox<VesselDbContext> Outbox()
    {
        PlayEventSql.RequireTransaction(db);
        // Fresh per outer transaction. Never reuse a rolled-back message context in the same request scope.
        return current ??= new DbContextOutbox<VesselDbContext>(runtime, db, []);
    }

    public Task<IReadOnlyList<EventEnvelopeReference>> StageAsync(PlayEvent message, CancellationToken cancellationToken) =>
        PlayEventSql.ParticipateAsync<IReadOnlyList<EventEnvelopeReference>>(db, async () =>
    {
        cancellationToken.ThrowIfCancellationRequested();
        var outbox = Outbox();
        var previous = outbox.Outstanding.Select(e => e.Id).ToHashSet();
        await outbox.BroadcastToTopicAsync(message.Type, message,
            new DeliveryOptions { CorrelationId = message.Id.ToString() });
        return outbox.Outstanding.Where(e => !previous.Contains(e.Id))
            .Select(e => new EventEnvelopeReference(host.Schema, e.Id)).ToArray();
    }, cancellationToken);

    public Task StageAsync(MonitorAccountCommand command, CancellationToken cancellationToken) =>
        PlayEventSql.ParticipateAsync(db, async () =>
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Outbox().SendAsync(command);
    }, cancellationToken);

    public async Task FlushAsync(CancellationToken cancellationToken)
    {
        if (current is null) return;
        // EF keeps CurrentTransaction until it is disposed, even after CommitAsync. The caller owns that boundary.
        await current.FlushOutgoingMessagesAsync();
    }

    public void Reset() => current = null;
}
