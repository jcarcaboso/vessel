using Npgsql;

namespace Vessel.Persistence.Events.Subscriptions;

/// <summary>Server-wide registrations and owner discovery; never resolves an owner-bound context.</summary>
public sealed class SystemEventSubscriptionStore(NpgsqlDataSource data)
{
    public async Task<bool> RegisterAsync(EventSubscription subscription, CancellationToken ct)
    {
        await using var connection = await data.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using var insert = new NpgsqlCommand("""
            WITH reg AS (
                INSERT INTO event_subscription_registrations(name,module,filters,filter_fingerprint,registered_at)
                VALUES(@name,@module,@filters,@fp,now())
                ON CONFLICT(name) DO NOTHING RETURNING name
            ), progress AS (
                INSERT INTO event_subscriptions(owner_id,name,module,filters,filter_fingerprint,
                    responsible_from,low_water_mark,status,registered_at,updated_at)
                SELECT c.owner_id,reg.name,@module,@filters,@fp,c.sequence,c.sequence,'active',now(),now()
                FROM reg CROSS JOIN event_cursors c ON CONFLICT DO NOTHING
            )
            SELECT EXISTS(SELECT 1 FROM reg)
            """, connection, transaction);
        Parameters(insert, subscription);
        var created = (bool)(await insert.ExecuteScalarAsync(ct))!;
        await using var verify = new NpgsqlCommand("""
            SELECT module,filter_fingerprint FROM event_subscription_registrations WHERE name=@name FOR KEY SHARE
            """, connection, transaction);
        verify.Parameters.AddWithValue("name", subscription.Name);
        await using (var row = await verify.ExecuteReaderAsync(ct))
        {
            if (!await row.ReadAsync(ct) || row.GetString(0) != subscription.Module || row.GetString(1) != subscription.Fingerprint)
                throw new InvalidOperationException(
                    $"Subscription '{subscription.Name}' is registered with a different module or filter. A changed filter needs a new subscription name.");
        }
        await transaction.CommitAsync(ct);
        return created;
    }

    /// <summary>DELETE takes the exclusive row lock; progress and receipts cascade in this same statement.</summary>
    public async Task<bool> DeregisterAsync(string name, CancellationToken ct)
    {
        await using var command = data.CreateCommand("DELETE FROM event_subscription_registrations WHERE name=@name");
        command.Parameters.AddWithValue("name", name);
        return await command.ExecuteNonQueryAsync(ct) == 1;
    }

    public async Task<IReadOnlyList<Guid>> CatchUpOwnersAsync(EventSubscription subscription, Guid? after,
        DateTimeOffset now, CancellationToken ct)
    {
        await using var command = data.CreateCommand("""
            SELECT c.owner_id FROM event_cursors c
            JOIN event_subscription_registrations r ON r.name=@name AND r.module=@module AND r.filter_fingerprint=@fp
            LEFT JOIN event_subscriptions s ON s.owner_id=c.owner_id AND s.name=r.name
            WHERE (@after IS NULL OR c.owner_id>@after) AND (
                s.name IS NULL OR c.sequence>s.low_water_mark OR EXISTS(
                    SELECT 1 FROM event_receipts p WHERE p.owner_id=c.owner_id AND p.subscription=r.name
                    AND p.state='pending' AND p.next_attempt_at<=@now))
            ORDER BY c.owner_id LIMIT 100
            """);
        Parameters(command, subscription);
        command.Parameters.AddWithValue("after", NpgsqlTypes.NpgsqlDbType.Uuid, (object?)after ?? DBNull.Value);
        command.Parameters.AddWithValue("now", now);
        return await OwnersAsync(command, ct);
    }

    public async Task<IReadOnlyList<Guid>> RetentionOwnersAsync(Guid? after, CancellationToken ct)
    {
        await using var command = data.CreateCommand(
            "SELECT owner_id FROM event_cursors WHERE (@after IS NULL OR owner_id>@after) ORDER BY owner_id LIMIT 100");
        command.Parameters.AddWithValue("after", NpgsqlTypes.NpgsqlDbType.Uuid, (object?)after ?? DBNull.Value);
        return await OwnersAsync(command, ct);
    }

    private static void Parameters(NpgsqlCommand command, EventSubscription subscription)
    {
        command.Parameters.AddWithValue("name", subscription.Name);
        command.Parameters.AddWithValue("module", subscription.Module);
        command.Parameters.AddWithValue("filters", subscription.Filters.ToArray());
        command.Parameters.AddWithValue("fp", subscription.Fingerprint);
    }

    private static async Task<IReadOnlyList<Guid>> OwnersAsync(NpgsqlCommand command, CancellationToken ct)
    {
        await using var rows = await command.ExecuteReaderAsync(ct);
        var owners = new List<Guid>();
        while (await rows.ReadAsync(ct)) owners.Add(rows.GetGuid(0));
        return owners;
    }
}
