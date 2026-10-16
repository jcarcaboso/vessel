using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Persistence.Events;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Messaging;

/// <summary>
/// Worker maintenance: catch-up for the subscriptions this host runs, every
/// <see cref="EventSubscriptionLimits.CatchUpInterval"/>, and the owner's retention sweep hourly. Replica-safe:
/// receipts and the low-water mark are claimed in PostgreSQL and floor decisions are serialized per owner.
/// Registered by a worker host, never by the API.
/// </summary>
public sealed class SubscriptionMaintenanceService(MessagingHost host, IServiceScopeFactory scopes,
    ILogger<SubscriptionMaintenanceService> logger) : BackgroundService
{
    private static readonly TimeSpan RetentionInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = host.RunningSubscriptions.Count == 0 ? RetentionInterval
            : host.RunningSubscriptions.Min(s => s.Limits.CatchUpInterval);
        using var timer = new PeriodicTimer(interval);
        var retentionDue = DateTimeOffset.MinValue;
        do
        {
            if (DateTimeOffset.UtcNow >= retentionDue)
            {
                retentionDue = DateTimeOffset.UtcNow + RetentionInterval;
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<EventRetention>().RunAsync(stoppingToken);
                }
                catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Event retention failed with {ErrorType}.", error.GetType().Name);
                }
            }
            foreach (var subscription in host.RunningSubscriptions)
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<EventCatchUp>().RunAsync(subscription, stoppingToken);
                }
                catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Catch-up for subscription {Subscription} failed with {ErrorType}.",
                        subscription.Name, error.GetType().Name);
                }
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
