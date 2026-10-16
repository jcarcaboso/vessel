using Npgsql;

namespace Vessel.Persistence.Events;

/// <summary>
/// The browser stream epoch. A restored database can reach a client's former sequence with different events, so
/// the restore procedure (stop every host, restore, rotate, provision, start) gives every owner's stream a new
/// random epoch, and any cursor from before the restore gets a reset. <c>migrate</c> never rotates it.
/// </summary>
public static class EventStreamEpoch
{
    /// <summary>Offline administrator operation across all owners. Returns the number of owner streams rotated.</summary>
    public static async Task<int> RotateAsync(string connectionString, CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("UPDATE event_cursors SET epoch=gen_random_uuid()", connection);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
