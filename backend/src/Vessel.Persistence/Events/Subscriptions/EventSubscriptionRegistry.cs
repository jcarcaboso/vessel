using Microsoft.EntityFrameworkCore;
using Vessel.Application.Events;

namespace Vessel.Persistence.Events.Subscriptions;

public sealed record EventSubscriptionStatus(string Name, string Module, long ResponsibleFrom, long LowWaterMark,
    string Status, long? GapFrom, long? GapTo, int PendingReceipts, int FailedReceipts);

/// <summary>Registrations in PostgreSQL. Provisioning is insert-only; a registration's filter never changes.</summary>
public sealed class EventSubscriptionRegistry(VesselDbContext db, UnitOfWork work, TimeProvider time)
{
    /// <summary>
    /// Registers a subscription for the scope's owner, responsible from the owner's current committed sequence.
    /// An existing registration keeps its start and progress; a different filter or module is rejected.
    /// </summary>
    public Task<bool> RegisterAsync(EventSubscription subscription, CancellationToken cancellationToken) => work.ExecuteAsync(async () =>
    {
        // The committed cursor bounds every allocated sequence: an in-flight event commits above it.
        var created = await VesselEventSql.ScalarAsync(db, """
            INSERT INTO event_subscriptions(owner_id,name,module,filters,filter_fingerprint,responsible_from,low_water_mark,
                                            status,registered_at,updated_at)
            SELECT @owner,@name,@module,@filters,@fingerprint,s.sequence,s.sequence,'active',@now,@now
            FROM (SELECT COALESCE((SELECT sequence FROM event_cursors WHERE owner_id=@owner),0) AS sequence) s
            ON CONFLICT (owner_id,name) DO NOTHING RETURNING 1
            """, cancellationToken, ("owner", db.CurrentOwnerId), ("name", subscription.Name), ("module", subscription.Module),
            ("filters", subscription.Filters.ToArray()), ("fingerprint", subscription.Fingerprint), ("now", time.GetUtcNow())) is not null;
        await using var command = VesselEventSql.TransactionCommand(db, """
            SELECT module,filter_fingerprint FROM event_subscriptions WHERE owner_id=@owner AND name=@name
            """, ("owner", db.CurrentOwnerId), ("name", subscription.Name));
        await using (var row = await command.ExecuteReaderAsync(cancellationToken))
        {
            await row.ReadAsync(cancellationToken);
            if (row.GetString(0) != subscription.Module || row.GetString(1) != subscription.Fingerprint)
                throw new InvalidOperationException(
                    $"Subscription '{subscription.Name}' is registered with a different module or filter. A changed filter needs a new subscription name.");
        }
        return created;
    }, cancellationToken);

    /// <summary>Removes a registration and its receipts, releasing anything it held.</summary>
    public Task<bool> DeregisterAsync(string name, CancellationToken cancellationToken) => work.ExecuteAsync(async () =>
        await VesselEventSql.ExecuteAsync(db, "DELETE FROM event_subscriptions WHERE owner_id=@owner AND name=@name",
            cancellationToken, ("owner", db.CurrentOwnerId), ("name", name)) == 1, cancellationToken);

    public async Task<IReadOnlyList<EventSubscriptionStatus>> ListAsync(CancellationToken cancellationToken)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = VesselEventSql.Command(db, """
                SELECT s.name,s.module,s.responsible_from,s.low_water_mark,s.status,s.gap_from,s.gap_to,
                       (SELECT count(*) FROM event_receipts r WHERE r.owner_id=s.owner_id AND r.subscription=s.name AND r.state='pending')::int,
                       (SELECT count(*) FROM event_receipts r WHERE r.owner_id=s.owner_id AND r.subscription=s.name AND r.state='failed')::int
                FROM event_subscriptions s WHERE s.owner_id=@owner ORDER BY s.name
                """, ("owner", db.CurrentOwnerId));
            await using var rows = await command.ExecuteReaderAsync(cancellationToken);
            var result = new List<EventSubscriptionStatus>();
            while (await rows.ReadAsync(cancellationToken))
                result.Add(new(rows.GetString(0), rows.GetString(1), rows.GetInt64(2), rows.GetInt64(3), rows.GetString(4),
                    rows.IsDBNull(5) ? null : rows.GetInt64(5), rows.IsDBNull(6) ? null : rows.GetInt64(6), rows.GetInt32(7), rows.GetInt32(8)));
            return result;
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    internal static string[] MatchingTypes(EventSubscription subscription) =>
        VesselEventValues.Types.Where(subscription.Matches).ToArray();
}
