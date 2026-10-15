using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Common;
using Vessel.Application.Events;

namespace Vessel.Persistence.Events;

// Read/SSE paths never resolve the outbox, runtime, broker or a mutation boundary.
public sealed class VesselEventHistory(VesselDbContext db) : IVesselEventReader
{
    public async Task<VesselEventPage> ReadAsync(string? after, int limit, CancellationToken cancellationToken)
    {
        if (!VesselEventCursor.TryParse(after, out var cursor) || limit is < 1 or > 200)
            throw new ProblemException(400, "Invalid event cursor or limit.");
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            // Cursor, floor, epoch and events come from ONE PostgreSQL statement snapshot, including concurrent pruning.
            await using var command = VesselEventSql.Command(db, """
                WITH cursor AS (
                    SELECT COALESCE(max(sequence),0) AS sequence, COALESCE(max(retention_floor),0) AS floor,
                           (array_agg(epoch))[1] AS epoch
                    FROM event_cursors WHERE owner_id=@owner
                )
                SELECT c.sequence,c.floor,c.epoch,e.sequence,e.payload::text
                FROM cursor c LEFT JOIN LATERAL (
                    SELECT sequence,payload FROM events
                    WHERE owner_id=@owner AND sequence>@after AND sequence>c.floor AND @after<=c.sequence
                      AND (@epoch IS NULL OR c.epoch=@epoch)
                    ORDER BY sequence LIMIT @limit
                ) e ON true ORDER BY e.sequence
                """, ("owner", db.CurrentOwnerId), ("after", cursor.Sequence), ("limit", limit),
                ("epoch", (object?)cursor.Epoch ?? DBNull.Value));
            ((Npgsql.NpgsqlParameter)command.Parameters["epoch"]).NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
            await using var rows = await command.ExecuteReaderAsync(cancellationToken);
            var events = new List<VesselEvent>();
            long latest = 0, floor = 0, next = cursor.Sequence;
            Guid? epoch = null;
            while (await rows.ReadAsync(cancellationToken))
            {
                latest = rows.GetInt64(0); floor = rows.GetInt64(1);
                epoch = rows.IsDBNull(2) ? null : rows.GetGuid(2);
                if (rows.IsDBNull(3)) continue;
                next = rows.GetInt64(3);
                events.Add(JsonSerializer.Deserialize<VesselEvent>(rows.GetString(4), VesselEventJson.Options)!);
            }
            // "0" (no epoch) starts a stream; any other epoch, a pruned or a future cursor needs a state reload.
            var reset = cursor.Epoch is null ? cursor.Sequence != 0 : cursor.Epoch != epoch;
            reset |= cursor.Sequence < floor || cursor.Sequence > latest;
            return new(reset ? [] : events, VesselEventCursor.Format(epoch, reset ? latest : next), reset);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }
}
