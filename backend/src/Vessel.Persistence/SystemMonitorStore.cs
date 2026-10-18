using Npgsql;
using NpgsqlTypes;
using Vessel.Application.Monitoring;

namespace Vessel.Persistence;

public sealed class SystemMonitorStore(NpgsqlDataSource data, TimeProvider time) : ISystemMonitorStore
{
    public async Task<IReadOnlyList<DueMonitorCandidate>> DueCandidatesAsync(DueMonitorKey? after, DateTimeOffset dueBy, int limit, CancellationToken ct)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(limit, 1000);
        await using var command = data.CreateCommand("""
            WITH due AS (
                SELECT a."OwnerId" AS owner_id, a."Id" AS account_id, a."VenueId" AS venue_id,
                    COALESCE(m."NextRunAtUtc", m."LastAttemptAtUtc", TIMESTAMPTZ '1970-01-01') AS due_at
                FROM accounts a JOIN monitor_accounts m ON m."AccountId" = a."Id" AND m."OwnerId" = a."OwnerId"
                WHERE a."IsEnabled" AND a."SourceId" IS NOT NULL
                    AND (m."NextRunAtUtc" <= @now OR m."ManualState" <> 'idle')
                    AND (m."LeaseUntilUtc" IS NULL OR m."LeaseUntilUtc" <= @now)
                    AND NOT EXISTS (SELECT 1 FROM server_venue_deadlines d
                        WHERE d.venue_id = a."VenueId" AND d.retry_after_until > @now)
            )
            SELECT owner_id, account_id, venue_id, due_at FROM due WHERE due_at <= @due_by
                AND (@after_due IS NULL OR (due_at, owner_id, account_id) > (@after_due, @after_owner, @after_account))
            ORDER BY due_at, owner_id, account_id LIMIT @limit
            """);
        command.Parameters.AddWithValue("now", time.GetUtcNow());
        command.Parameters.AddWithValue("due_by", NpgsqlDbType.TimestampTz, dueBy.ToUniversalTime());
        command.Parameters.AddWithValue("after_due", NpgsqlDbType.TimestampTz, (object?)after?.DueAt ?? DBNull.Value);
        command.Parameters.AddWithValue("after_owner", NpgsqlDbType.Uuid, (object?)after?.OwnerId ?? DBNull.Value);
        command.Parameters.AddWithValue("after_account", NpgsqlDbType.Uuid, (object?)after?.AccountId ?? DBNull.Value);
        command.Parameters.AddWithValue("limit", limit);
        await using var rows = await command.ExecuteReaderAsync(ct);
        var result = new List<DueMonitorCandidate>();
        while (await rows.ReadAsync(ct)) result.Add(new(rows.GetGuid(0), rows.GetGuid(1), rows.GetString(2), rows.GetFieldValue<DateTimeOffset>(3)));
        return result;
    }
}
