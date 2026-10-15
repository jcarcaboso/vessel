using Vessel.Application.Common;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Events;
using Vessel.Application.Workspace;

namespace Vessel.Persistence.Events;

// Read/SSE paths never resolve the outbox, runtime, broker or a mutation boundary.
public sealed class PlayEventHistory(VesselDbContext db) : IPlayEventReader
{
    public async Task<PlayEventPage> ReadAsync(long after, int limit, CancellationToken cancellationToken)
    {
        if (after < 0 || limit is < 1 or > 200) throw new ProblemException(400, "Invalid event cursor or limit.");
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            // Cursor and events come from ONE PostgreSQL statement snapshot, including concurrent pruning.
            await using var command = PlayEventSql.Command(db, """
                WITH cursor AS (
                    SELECT COALESCE((SELECT sequence FROM play_event_cursors WHERE owner_id=@owner),0) AS sequence,
                           COALESCE((SELECT retention_floor FROM play_event_cursors WHERE owner_id=@owner),0) AS floor
                )
                SELECT c.sequence,c.floor,e.sequence,e.payload::text
                FROM cursor c LEFT JOIN LATERAL (
                    SELECT sequence,payload FROM play_events
                    WHERE owner_id=@owner AND sequence>@after
                      AND @after>=c.floor AND @after<=c.sequence ORDER BY sequence LIMIT @limit
                ) e ON true ORDER BY e.sequence
                """, ("owner", db.CurrentOwnerId), ("after", after), ("limit", limit));
            await using var rows = await command.ExecuteReaderAsync(cancellationToken);
            var events = new List<PlayEvent>();
            long latest = 0, floor = 0, next = after;
            while (await rows.ReadAsync(cancellationToken))
            {
                latest = rows.GetInt64(0); floor = rows.GetInt64(1);
                if (rows.IsDBNull(2)) continue;
                next = rows.GetInt64(2);
                events.Add(JsonSerializer.Deserialize<PlayEvent>(rows.GetString(3), PlayEventStore.Json)!);
            }
            var reset = after < floor || after > latest;
            return new(events, (reset ? latest : next).ToString(CultureInfo.InvariantCulture), reset);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }
}
