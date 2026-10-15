using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Monitoring;
using Vessel.Application.Venues;
using Vessel.Persistence;

namespace Vessel.Worker;

/// <summary>TimeProvider and registry are normal DI inputs, including in isolated integration hosts.</summary>
public sealed class MonitorScheduler(IServiceScopeFactory scopes, TimeProvider time, MonitorOptions options,
    ILogger<MonitorScheduler> logger) : BackgroundService
{
    private readonly string workerId = Guid.NewGuid().ToString("N");
    private readonly List<Task> running = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(MonitorOptions.SchedulerTick, time);
        try
        {
            do
            {
                try { await TickAsync(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch { logger.LogWarning("Monitor scheduling or heartbeat failed. It will retry on the next tick."); }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { await Task.WhenAll(running); }
    }

    public async Task TickAsync(CancellationToken ct)
    {
        running.RemoveAll(t => t.IsCompleted);
        await using var scope = scopes.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMonitorStore>();
        var now = time.GetUtcNow();
        await store.RecordHeartbeatAsync(workerId, now, ct);
        // Write only after the durable heartbeat succeeds. No secrets or account information in this file.
        var file = options.HeartbeatFile;
        var temporary = file + "." + workerId + ".new";
        await File.WriteAllTextAsync(temporary, now.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), ct);
        File.Move(temporary, file, overwrite: true);
        var venues = scope.ServiceProvider.GetRequiredService<IVenueRegistry>();
        await store.DiscoverAsync(venues.Descriptors.Where(v => v.Capabilities is { Sync: true, Orders: true })
            .Select(v => v.Id).ToArray(), now, ct);
        if (running.Count >= 2) return;
        var leases = await store.ClaimDueAsync(workerId, now, 2 - running.Count, ct);
        foreach (var lease in leases) running.Add(RunAsync(lease, ct));
    }

    private async Task RunAsync(MonitorLease lease, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<MonitorRunExecutor>().RunAsync(lease, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch { logger.LogWarning("An account monitor attempt failed. Durable lease recovery will retry it."); }
    }
}
