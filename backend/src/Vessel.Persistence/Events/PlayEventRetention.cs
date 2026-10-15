using Microsoft.Extensions.Options;
using Vessel.Application.Ownership;

namespace Vessel.Persistence.Events;

public sealed class PlayEventRetention(VesselDbContext db, IUnitOfWork unitOfWork, IOptions<PlayEventSettings> settings)
{
    public Task<int> PruneAsync(int limit, CancellationToken ct) => unitOfWork.ExecuteAsync(async () =>
    {
        if (limit is < 1 or > 1000) throw new ArgumentOutOfRangeException(nameof(limit));
        PlayEventSql.RequireTransaction(db);
        // Same lock as append. Retention floor and deletions become visible together.
        await using (var cursor = PlayEventSql.TransactionCommand(db, """
            SELECT sequence FROM play_event_cursors WHERE owner_id=@owner FOR UPDATE
            """, ("owner", db.CurrentOwnerId)))
            await cursor.ExecuteScalarAsync(ct);
        var candidates = new List<(Guid Id, long Sequence)>();
        await using (var query = PlayEventSql.TransactionCommand(db, """
            SELECT e.event_id,e.sequence FROM play_events e WHERE e.owner_id=@owner AND e.detected_at<@before
              AND NOT EXISTS(SELECT 1 FROM event_deliveries d WHERE d.owner_id=e.owner_id AND d.event_id=e.event_id
                             AND d.state IN ('pending','failed'))
              AND NOT EXISTS(SELECT 1 FROM unnest(@consumers) c(consumer)
                  WHERE NOT EXISTS(SELECT 1 FROM event_deliveries d
                      WHERE d.owner_id=e.owner_id AND d.event_id=e.event_id AND d.consumer=c.consumer
                          AND d.state IN ('delivered','skipped','expired')))
            ORDER BY e.sequence LIMIT @limit FOR UPDATE OF e SKIP LOCKED
            """, ("owner", db.CurrentOwnerId), ("before", DateTimeOffset.UtcNow.AddDays(-settings.Value.RetentionDays)),
            ("limit", limit), ("consumers", settings.Value.DurableConsumers)))
        await using (var rows = await query.ExecuteReaderAsync(ct))
            while (await rows.ReadAsync(ct)) candidates.Add((rows.GetGuid(0), rows.GetInt64(1)));

        var deleted = 0;
        foreach (var candidate in candidates)
        {
            var references = new List<EventEnvelopeReference>();
            await using (var query = PlayEventSql.TransactionCommand(db, """
                SELECT schema_name,envelope_id FROM play_event_envelopes WHERE owner_id=@owner AND event_id=@id
                """, ("owner", db.CurrentOwnerId), ("id", candidate.Id)))
            await using (var rows = await query.ExecuteReaderAsync(ct))
                while (await rows.ReadAsync(ct)) references.Add(new(rows.GetString(0), rows.GetGuid(1)));
            var pending = false;
            foreach (var reference in references)
            {
                // Only schemas selected by the shared host helper are legal SQL identifiers.
                if (!PlayEventSettings.ValidSchema(reference.Schema) ||
                    reference.Schema != settings.Value.ApiStorageSchema && reference.Schema != settings.Value.WorkerStorageSchema)
                { pending = true; break; }
                await using var exists = PlayEventSql.TransactionCommand(db, "SELECT to_regclass(@table)",
                    ("table", $"{reference.Schema}.wolverine_outgoing_envelopes"));
                if (await exists.ExecuteScalarAsync(ct) is null or DBNull) { pending = true; break; }
                await using var envelope = PlayEventSql.TransactionCommand(db,
                    $"SELECT EXISTS(SELECT 1 FROM {reference.Schema}.wolverine_outgoing_envelopes WHERE id=@id)",
                    ("id", reference.EnvelopeId));
                if ((bool)(await envelope.ExecuteScalarAsync(ct))!) { pending = true; break; }
            }
            if (pending) continue;
            await using var prune = PlayEventSql.TransactionCommand(db, """
                DELETE FROM event_deliveries WHERE owner_id=@owner AND event_id=@id;
                DELETE FROM play_event_envelopes WHERE owner_id=@owner AND event_id=@id;
                DELETE FROM play_events WHERE owner_id=@owner AND event_id=@id;
                UPDATE play_event_cursors SET retention_floor=GREATEST(retention_floor,@sequence) WHERE owner_id=@owner;
                """, ("owner", db.CurrentOwnerId), ("id", candidate.Id), ("sequence", candidate.Sequence));
            await prune.ExecuteNonQueryAsync(ct);
            deleted++;
        }
        // No deletion of dedup keys, watch starts, source-fill identities or business history.
        return deleted;
    }, ct);
}
