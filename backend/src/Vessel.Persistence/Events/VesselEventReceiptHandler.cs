using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Events;
using Vessel.Application.Ownership;

namespace Vessel.Persistence.Events;

/// <summary>Durable monitor receipt, distinct from Wolverine's envelope inbox identity.</summary>
public sealed class VesselEventReceiptHandler
{
    public static async Task Handle(VesselEvent message, IServiceScopeFactory scopes, VesselEventHostIdentity host,
        CancellationToken cancellationToken)
    {
        // Never trust a broker message to establish an arbitrary owner.
        if (message.OwnerId == Guid.Empty || message.OwnerId != host.OwnerId) return;
        using var scope = scopes.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<DbContextOptions<VesselDbContext>>();
        // Validate the owner before constructing a new DbContext. HTTP and concurrent worker scopes cannot bleed.
        await using var db = new VesselDbContext(options, new EventOwner(message.OwnerId));
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // The broker is a hint. Require the durable business EventId and owner, not the received body.
        await using var receipt = VesselEventSql.Command(db, """
            UPDATE event_deliveries d SET state='delivered',attempts=attempts+1,completed_at=@now
            WHERE d.owner_id=@owner AND d.event_id=@id AND d.consumer='monitor' AND d.state IN ('pending','failed')
              AND EXISTS(SELECT 1 FROM events e WHERE e.owner_id=d.owner_id AND e.event_id=d.event_id)
            """, ("owner", message.OwnerId), ("id", message.Id), ("now", DateTimeOffset.UtcNow));
        if (await receipt.ExecuteNonQueryAsync(cancellationToken) == 0)
        {
            // A missing receipt on live history is not success. Pruning removes only terminal work;
            // its enduring business identity still proves a late duplicate was already settled.
            await using var terminal = VesselEventSql.Command(db, """
                SELECT EXISTS(SELECT 1 FROM event_deliveries d
                    JOIN events e ON e.owner_id=d.owner_id AND e.event_id=d.event_id
                    WHERE d.owner_id=@owner AND d.event_id=@id AND d.consumer='monitor'
                        AND d.state IN ('delivered','skipped','expired'))
                    OR (NOT EXISTS(SELECT 1 FROM events WHERE owner_id=@owner AND event_id=@id)
                        AND EXISTS(SELECT 1 FROM event_dedup WHERE owner_id=@owner AND event_id=@id))
                """, ("owner", message.OwnerId), ("id", message.Id));
            if (!(bool)(await terminal.ExecuteScalarAsync(cancellationToken))!)
                throw new InvalidOperationException("The durable monitor event receipt is missing.");
        }
        await transaction.CommitAsync(cancellationToken);
    }

    private sealed record EventOwner(Guid OwnerId) : IJournalOwnerContext;
}
