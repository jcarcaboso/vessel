using Npgsql;
using Vessel.Application.Monitoring;
using Vessel.Application.Venues;

namespace Vessel.Persistence;

public sealed class ServerStateStore(NpgsqlDataSource data, MonitorDeployments deployments) : IServerStateStore
{
    public async Task<DateTimeOffset?> VenueRetryAtAsync(string venueId, CancellationToken ct)
    {
        await using var command = data.CreateCommand("SELECT retry_after_until FROM server_venue_deadlines WHERE venue_id = @venue");
        command.Parameters.AddWithValue("venue", venueId);
        return await command.ExecuteScalarAsync(ct) is DateTime value ? new DateTimeOffset(value) : null;
    }

    public async Task<IReadOnlyDictionary<string, DateTimeOffset>> VenueRetriesAsync(CancellationToken ct)
    {
        await using var command = data.CreateCommand("SELECT venue_id, retry_after_until FROM server_venue_deadlines");
        await using var rows = await command.ExecuteReaderAsync(ct);
        var result = new Dictionary<string, DateTimeOffset>(StringComparer.Ordinal);
        while (await rows.ReadAsync(ct)) result.Add(rows.GetString(0), rows.GetFieldValue<DateTimeOffset>(1));
        return result;
    }

    public async Task DeferVenueAsync(string venueId, DateTimeOffset retryAtUtc, DateTimeOffset now, CancellationToken ct)
    {
        // Autocommit on a separate connection: the caller may still hold account locks and roll back its transaction.
        await using var command = data.CreateCommand("""
            INSERT INTO server_venue_deadlines (venue_id, retry_after_until) VALUES (@venue, @deadline)
            ON CONFLICT (venue_id) DO UPDATE
            SET retry_after_until = GREATEST(server_venue_deadlines.retry_after_until, EXCLUDED.retry_after_until)
            """);
        command.Parameters.AddWithValue("venue", venueId);
        command.Parameters.AddWithValue("deadline", VenueRateLimitException.Clamp(retryAtUtc, now));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<ServerMonitorHeartbeat?> HeartbeatAsync(CancellationToken ct)
    {
        // Only deployments configured to run the monitor can make monitor health green.
        await using var command = data.CreateCommand("""
            SELECT deployment, seen_at FROM server_monitor_heartbeats
            WHERE deployment = ANY(@deployments) ORDER BY seen_at DESC LIMIT 1
            """);
        command.Parameters.AddWithValue("deployments", deployments.Ids.ToArray());
        await using var rows = await command.ExecuteReaderAsync(ct);
        return await rows.ReadAsync(ct) ? new(rows.GetString(0), rows.GetFieldValue<DateTimeOffset>(1)) : null;
    }

    public async Task RecordHeartbeatAsync(string deployment, DateTimeOffset now, CancellationToken ct)
    {
        if (!deployments.Ids.Contains(deployment, StringComparer.Ordinal))
            throw new InvalidOperationException("Only a configured monitor deployment can record monitor health.");
        await using var command = data.CreateCommand("""
            INSERT INTO server_monitor_heartbeats (deployment, seen_at) VALUES (@deployment, @now)
            ON CONFLICT (deployment) DO UPDATE SET seen_at = GREATEST(server_monitor_heartbeats.seen_at, EXCLUDED.seen_at)
            """);
        command.Parameters.AddWithValue("deployment", deployment);
        command.Parameters.AddWithValue("now", now);
        await command.ExecuteNonQueryAsync(ct);
    }
}
