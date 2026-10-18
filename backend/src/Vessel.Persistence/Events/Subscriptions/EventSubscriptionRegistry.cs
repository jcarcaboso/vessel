using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Events;

namespace Vessel.Persistence.Events.Subscriptions;

public sealed record EventSubscriptionStatus(string Name, string Module, long ResponsibleFrom, long LowWaterMark,
    string Status, long? GapFrom, long? GapTo, int PendingReceipts, int FailedReceipts);

/// <summary>Owner progress reads, with server-wide registration operations delegated to the system store.</summary>
public sealed class EventSubscriptionRegistry(VesselDbContext db, SystemEventSubscriptionStore registrations)
{
    public Task<bool> RegisterAsync(EventSubscription subscription, CancellationToken cancellationToken) =>
        registrations.RegisterAsync(subscription, cancellationToken);

    public Task<bool> DeregisterAsync(string name, CancellationToken cancellationToken) =>
        registrations.DeregisterAsync(name, cancellationToken);

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

    /// <summary>
    /// Host start check: every subscription this host runs needs its keyed <see cref="IVesselEventSubscriber"/>.
    /// A missing handler is a configuration error, so the host fails fast instead of failing each delivery.
    /// </summary>
    public static void EnsureHandlers(IServiceProvider services, IEnumerable<EventSubscription> subscriptions)
    {
        var keyed = services.GetRequiredService<IServiceProviderIsKeyedService>();
        var missing = subscriptions.Where(s => !keyed.IsKeyedService(typeof(IVesselEventSubscriber), s.Name))
            .Select(s => s.Name).ToArray();
        if (missing.Length != 0)
            throw new InvalidOperationException(
                $"No event handler is registered for subscription(s) {string.Join(", ", missing)}. Register a keyed IVesselEventSubscriber in the owning module.");
    }

    internal static string[] MatchingTypes(EventSubscription subscription) =>
        VesselEventValues.Types.Where(subscription.Matches).ToArray();
}
