using Microsoft.Extensions.Logging;

namespace Vessel.Persistence.Events.Subscriptions;

internal enum SubscriptionRegistration { Absent, Compatible, Incompatible }

/// <summary>Subscriber-side initialization. Callers hold the owner's shared retention lock.</summary>
internal static class SubscriptionProgress
{
    internal static async Task<SubscriptionRegistration> LockRegistrationAsync(VesselDbContext db,
        EventSubscription subscription, ILogger logger, CancellationToken ct)
    {
        await using var command = VesselEventSql.TransactionCommand(db, """
            SELECT module,filter_fingerprint FROM event_subscription_registrations
            WHERE name=@name FOR KEY SHARE
            """, ("name", subscription.Name));
        await using var row = await command.ExecuteReaderAsync(ct);
        if (!await row.ReadAsync(ct)) return SubscriptionRegistration.Absent;
        if (row.GetString(0) == subscription.Module && row.GetString(1) == subscription.Fingerprint)
            return SubscriptionRegistration.Compatible;
        logger.LogWarning("Subscription {Subscription} is registered with a different filter or module; no events will be handled.",
            subscription.Name);
        return SubscriptionRegistration.Incompatible;
    }

    internal static async Task<long?> InitializeAsync(VesselDbContext db, EventSubscription subscription, ILogger logger,
        CancellationToken ct)
    {
        // Lock the registration first: a concurrent DELETE must wait for initialization and settlement.
        if (await LockRegistrationAsync(db, subscription, logger, ct) != SubscriptionRegistration.Compatible) return null;
        await VesselEventSql.ExecuteAsync(db, """
            INSERT INTO event_subscriptions(owner_id,name,module,filters,filter_fingerprint,responsible_from,
                low_water_mark,status,gap_from,gap_to,registered_at,updated_at)
            SELECT @owner,r.name,r.module,r.filters,r.filter_fingerprint,0,f.floor,
                CASE WHEN f.floor>0 THEN 'lagging' ELSE 'active' END,
                CASE WHEN f.floor>0 THEN 1 END,CASE WHEN f.floor>0 THEN f.floor END,now(),now()
            FROM event_subscription_registrations r
            CROSS JOIN (SELECT COALESCE((SELECT retention_floor FROM event_cursors WHERE owner_id=@owner),0) AS floor) f
            WHERE r.name=@name AND r.filter_fingerprint=@fp
            ON CONFLICT DO NOTHING
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription.Name), ("fp", subscription.Fingerprint));
        return await VesselEventSql.ScalarAsync(db, """
            SELECT responsible_from FROM event_subscriptions WHERE owner_id=@owner AND name=@name FOR KEY SHARE
            """, ct, ("owner", db.CurrentOwnerId), ("name", subscription.Name)) is long responsible ? responsible : null;
    }
}
