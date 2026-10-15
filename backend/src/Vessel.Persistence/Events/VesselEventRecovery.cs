using System.Text.Json;
using Vessel.Application.Events;
using Vessel.Application.Ownership;

namespace Vessel.Persistence.Events;

/// <summary>Recover publication or broker loss using the original business IDs and durable consumer work.</summary>
public sealed class VesselEventRecovery(VesselDbContext db, IUnitOfWork unitOfWork, IVesselEventOutbox outbox)
{
    public Task<int> RepublishPendingAsync(int limit, CancellationToken ct) => unitOfWork.ExecuteAsync(async () =>
    {
        if (limit is < 1 or > 200) throw new ArgumentOutOfRangeException(nameof(limit));
        VesselEventSql.RequireTransaction(db);
        var messages = new List<VesselEvent>();
        // SKIP LOCKED bounds concurrent recovery sweeps; receipts remain the business deduplication record.
        await using (var query = VesselEventSql.TransactionCommand(db, """
            SELECT e.payload::text FROM events e WHERE e.owner_id=@owner
                AND EXISTS(SELECT 1 FROM event_deliveries d WHERE d.owner_id=e.owner_id AND d.event_id=e.event_id
                    AND d.state IN ('pending','failed')
                    AND (d.last_republished_at IS NULL OR d.last_republished_at<@retry))
            ORDER BY e.sequence LIMIT @limit FOR UPDATE OF e SKIP LOCKED
            """, ("owner", db.CurrentOwnerId), ("retry", DateTimeOffset.UtcNow.AddSeconds(-30)), ("limit", limit)))
        await using (var rows = await query.ExecuteReaderAsync(ct))
            while (await rows.ReadAsync(ct)) messages.Add(JsonSerializer.Deserialize<VesselEvent>(rows.GetString(0), VesselEventStore.Json)!);
        foreach (var message in messages)
        {
            var envelopes = await outbox.StageAsync(message, ct);
            foreach (var envelope in envelopes)
            {
                await using var reference = VesselEventSql.TransactionCommand(db, """
                    INSERT INTO event_envelopes(owner_id,event_id,schema_name,envelope_id)
                    VALUES(@owner,@id,@schema,@envelope) ON CONFLICT DO NOTHING
                    """, ("owner", db.CurrentOwnerId), ("id", message.Id), ("schema", envelope.Schema), ("envelope", envelope.EnvelopeId));
                await reference.ExecuteNonQueryAsync(ct);
            }
            await using var attempted = VesselEventSql.TransactionCommand(db, """
                UPDATE event_deliveries SET last_republished_at=@now WHERE owner_id=@owner AND event_id=@id
                    AND state IN ('pending','failed')
                """, ("owner", db.CurrentOwnerId), ("id", message.Id), ("now", DateTimeOffset.UtcNow));
            await attempted.ExecuteNonQueryAsync(ct);
        }
        return messages.Count;
    }, ct);
}
