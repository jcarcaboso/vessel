using Npgsql;
using NpgsqlTypes;

namespace Vessel.Persistence.Notifications;

/// <summary>Reviewed system discovery: notification owner IDs only, including suspended owners.</summary>
public sealed class SystemNotificationStore(NpgsqlDataSource data)
{
    public async Task<IReadOnlyList<Guid>> RetentionOwnersAsync(Guid? after, CancellationToken ct)
    {
        await using var command = data.CreateCommand("""
            SELECT owner_id FROM (
                (SELECT owner_id FROM notification_cursors
                 WHERE (@after IS NULL OR owner_id>@after) ORDER BY owner_id LIMIT 100)
                UNION
                (SELECT DISTINCT owner_id FROM notification_sources
                 WHERE (@after IS NULL OR owner_id>@after) ORDER BY owner_id LIMIT 100)
            ) owners ORDER BY owner_id LIMIT 100
            """);
        command.Parameters.AddWithValue("after", NpgsqlDbType.Uuid, (object?)after ?? DBNull.Value);
        await using var rows = await command.ExecuteReaderAsync(ct);
        var owners = new List<Guid>();
        while (await rows.ReadAsync(ct)) owners.Add(rows.GetGuid(0));
        return owners;
    }
}
