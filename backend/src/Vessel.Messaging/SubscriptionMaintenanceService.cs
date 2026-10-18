using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Persistence.Events;
using Vessel.Application.Ownership;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Messaging;

/// <summary>
/// Worker maintenance: catch-up for the subscriptions this host runs, every
/// <see cref="EventSubscriptionLimits.CatchUpInterval"/>, and retention for every retained owner hourly. Replica-safe:
/// receipts and the low-water mark are claimed in PostgreSQL and floor decisions are serialized per owner.
/// Registered by a worker host, never by the API.
/// </summary>
public sealed class SubscriptionMaintenanceService(MessagingHost host, IOwnerScopeFactory scopes,
    IJournalOwnerDirectory owners, SystemEventSubscriptionStore store, TimeProvider time,
    ILogger<SubscriptionMaintenanceService> logger, IEnumerable<IMaintenanceHeartbeat>? heartbeats = null) : BackgroundService
{
    private readonly Dictionary<string, Guid?> continuations = new(StringComparer.Ordinal);
    private static readonly TimeSpan RetentionInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = host.RunningSubscriptions.Count == 0 ? RetentionInterval
            : host.RunningSubscriptions.Min(s => s.Limits.CatchUpInterval);
        using var timer = new PeriodicTimer(interval);
        var retentionDue = DateTimeOffset.MinValue;
        do
        {
            if (time.GetUtcNow() >= retentionDue)
            {
                retentionDue = time.GetUtcNow() + RetentionInterval;
                try
                {
                    await RunRetentionAsync(stoppingToken);
                }
                catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Event retention failed with {ErrorType}.", error.GetType().Name);
                }
            }
            await RunCatchUpPassAsync(stoppingToken);
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<bool> RunCatchUpPassAsync(CancellationToken ct)
    {
        var productive = true;
        foreach (var subscription in host.RunningSubscriptions)
        {
            try
            {
                productive &= await RunCatchUpAsync(subscription, ct);
            }
            catch (Exception error) when (!ct.IsCancellationRequested)
            {
                productive = false;
                logger.LogWarning("Catch-up for subscription {Subscription} failed with {ErrorType}.",
                    subscription.Name, error.GetType().Name);
            }
        }
        // A caught per-owner failure is still an unproductive pass, even though later owners keep running.
        if (productive)
            foreach (var heartbeat in heartbeats ?? [])
            {
                try { await heartbeat.BeatAsync(ct); }
                catch (Exception error) when (!ct.IsCancellationRequested)
                {
                    productive = false;
                    logger.LogWarning("A maintenance heartbeat failed with {ErrorType}.", error.GetType().Name);
                }
            }
        return productive;
    }

    public async Task RunRetentionAsync(CancellationToken ct)
    {
        Guid? after = null;
        while (true)
        {
            var page = await store.RetentionOwnersAsync(after, ct);
            if (page.Count == 0) return;
            foreach (var owner in page)
            {
                after = owner;
                try
                {
                    await using var scope = scopes.Create(owner);
                    await scope.Services.GetRequiredService<EventRetention>().RunAsync(ct);
                }
                catch (Exception error) when (!ct.IsCancellationRequested)
                {
                    logger.LogWarning("Event retention for owner {OwnerId} failed with {ErrorType}.", owner, error.GetType().Name);
                }
            }
        }
    }

    public async Task<bool> RunCatchUpAsync(EventSubscription subscription, CancellationToken ct)
    {
        continuations.TryGetValue(subscription.Name, out var after);
        var page = await store.CatchUpOwnersAsync(subscription, after, time.GetUtcNow(), ct);
        var productive = true;
        foreach (var owner in page)
        {
            continuations[subscription.Name] = owner;
            try
            {
                if (await owners.StatusAsync(owner, ct) != JournalOwnerStatus.Active) continue;
                await using var scope = scopes.Create(owner);
                await scope.Services.GetRequiredService<EventCatchUp>().RunAsync(subscription, ct);
            }
            catch (Exception error) when (!ct.IsCancellationRequested)
            {
                productive = false;
                logger.LogWarning("Catch-up for subscription {Subscription}, owner {OwnerId} failed with {ErrorType}.",
                    subscription.Name, owner, error.GetType().Name);
            }
        }
        if (page.Count < 100) continuations[subscription.Name] = null;
        return productive;
    }
}

/// <summary>
/// A module's health signal, written after each maintenance pass in which every catch-up the host runs succeeded.
/// It must clear its own signal when it cannot record it, so a stuck host never looks healthy.
/// </summary>
public interface IMaintenanceHeartbeat
{
    Task BeatAsync(CancellationToken cancellationToken);
}
