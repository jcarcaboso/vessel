using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Notifications;
using Vessel.Application.Ownership;
using Vessel.Messaging;

namespace Vessel.Worker;

/// <summary>
/// The notifications worker's health: after each maintenance pass in which every catch-up succeeded, it writes
/// <c>&lt;unix seconds&gt; &lt;timeout seconds&gt;</c> to its own heartbeat file and its own heartbeat row. It never
/// touches the monitor's, so a healthy notifications worker cannot make a stopped monitor look online.
/// </summary>
public sealed class NotificationHeartbeat(IServiceScopeFactory scopes, NotificationOptions options, TimeProvider time) : IMaintenanceHeartbeat
{
    private readonly string workerId = Guid.NewGuid().ToString("N");

    public async Task BeatAsync(CancellationToken cancellationToken)
    {
        var file = options.HeartbeatFile;
        try
        {
            var now = time.GetUtcNow();
            var temporary = file + "." + workerId + ".new";
            await File.WriteAllTextAsync(temporary, string.Create(CultureInfo.InvariantCulture,
                $"{now.ToUnixTimeSeconds()} {(long)options.HeartbeatTimeout.TotalSeconds}"), cancellationToken);
            File.Move(temporary, file, overwrite: true);
            await using var scope = scopes.CreateAsyncScope();
            var store = scope.ServiceProvider.GetRequiredService<INotificationStore>();
            await scope.ServiceProvider.GetRequiredService<IUnitOfWork>().ExecuteAsync(async () =>
            {
                await store.RecordHeartbeatAsync(workerId, now, cancellationToken);
                return true;
            }, cancellationToken);
        }
        catch
        {
            // Neither the container nor the API may report a worker healthy whose heartbeat cannot be recorded.
            try { File.Delete(file); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            throw;
        }
    }
}

/// <summary>Hourly: deletes notifications older than <c>RetentionDays</c> with their sources and deliveries.</summary>
public sealed class NotificationRetentionService(IServiceScopeFactory scopes, NotificationOptions options, TimeProvider time,
    ILogger<NotificationRetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, time);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var store = scope.ServiceProvider.GetRequiredService<INotificationStore>();
                var cutoff = time.GetUtcNow().AddDays(-options.RetentionDays);
                await scope.ServiceProvider.GetRequiredService<IUnitOfWork>().ExecuteAsync(() => store.RetainAsync(cutoff, stoppingToken), stoppingToken);
            }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("Notification retention failed with {ErrorType}.", error.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
