using Npgsql;

namespace Vessel.Persistence.Notifications;

public sealed record NotificationDeployments(IReadOnlyList<string> Ids);

/// <summary>
/// Reviewed system store: only deployment health, never journal data or an owner's transaction.
/// Monitor and notification health use separate tables and separate configured deployment sets.
/// </summary>
public sealed class NotificationWorkerState(NpgsqlDataSource data, NotificationDeployments deployments)
{
    public async Task<DateTimeOffset?> HeartbeatAsync(CancellationToken ct)
    {
        await using var command = data.CreateCommand("""
            SELECT seen_at FROM server_notification_heartbeats
            WHERE deployment = ANY(@deployments) ORDER BY seen_at DESC LIMIT 1
            """);
        command.Parameters.AddWithValue("deployments", deployments.Ids.ToArray());
        return await command.ExecuteScalarAsync(ct) is DateTime seen ? new DateTimeOffset(seen) : null;
    }

    public async Task RecordAsync(string deployment, DateTimeOffset now, CancellationToken ct)
    {
        if (!deployments.Ids.Contains(deployment, StringComparer.Ordinal))
            throw new InvalidOperationException("Only a configured notifications deployment can record notification health.");
        await using var command = data.CreateCommand("""
            INSERT INTO server_notification_heartbeats (deployment, seen_at) VALUES (@deployment, @now)
            ON CONFLICT (deployment) DO UPDATE SET seen_at = GREATEST(server_notification_heartbeats.seen_at, EXCLUDED.seen_at)
            """);
        command.Parameters.AddWithValue("deployment", deployment);
        command.Parameters.AddWithValue("now", now);
        await command.ExecuteNonQueryAsync(ct);
    }
}
