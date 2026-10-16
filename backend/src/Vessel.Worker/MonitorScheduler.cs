using System.Globalization;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Monitoring;
using Vessel.Application.Venues;
using Vessel.Persistence;

namespace Vessel.Worker;

/// <summary>Coalesces command wake-ups into at most one early scheduling pass.</summary>
public sealed class MonitorWakeup : IMonitorWakeup
{
    private readonly Channel<bool> signals = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        { FullMode = BoundedChannelFullMode.DropWrite });
    public void Wake() => signals.Writer.TryWrite(true);
    internal ValueTask<bool> WaitAsync(CancellationToken ct) => signals.Reader.WaitToReadAsync(ct);
    internal void Consume() => signals.Reader.TryRead(out _);
}

/// <summary>
/// Every <see cref="MonitorOptions.SchedulerTick"/>, or early when a command arrives: discover accounts, claim due
/// rows and run at most two. The heartbeat row and file advance only after such a productive pass.
/// TimeProvider and registry are normal DI inputs, including in isolated integration hosts.
/// </summary>
public sealed class MonitorScheduler(IServiceScopeFactory scopes, TimeProvider time, MonitorOptions options,
    MonitorWakeup wakeup, ILogger<MonitorScheduler> logger) : BackgroundService
{
    private readonly string workerId = Guid.NewGuid().ToString("N");
    private readonly List<Task> running = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(MonitorOptions.SchedulerTick, time);
        var tick = Task.FromResult(true);
        try
        {
            while (true)
            {
                if (tick.IsCompleted)
                {
                    if (!await tick) break;
                    tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
                }
                wakeup.Consume();
                try { await TickAsync(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception error)
                {
                    logger.LogWarning("Monitor scheduling failed with {ErrorType}. It will retry on the next tick.", error.GetType().Name);
                }
                await Task.WhenAny(tick, wakeup.WaitAsync(stoppingToken).AsTask());
                stoppingToken.ThrowIfCancellationRequested();
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { await Task.WhenAll(running); }
    }

    public async Task TickAsync(CancellationToken ct)
    {
        running.RemoveAll(t => t.IsCompleted);
        await using (var scope = scopes.CreateAsyncScope())
        {
            var now = time.GetUtcNow();
            var venues = scope.ServiceProvider.GetRequiredService<IVenueRegistry>();
            await scope.ServiceProvider.GetRequiredService<MonitorCoordinator>().DiscoverAsync(venues.Descriptors
                .Where(v => v.Capabilities is { Sync: true, Orders: true }).Select(v => v.Id).ToArray(), now, ct);
            if (running.Count < 2)
            {
                var leases = await scope.ServiceProvider.GetRequiredService<IMonitorStore>()
                    .ClaimDueAsync(workerId, now, 2 - running.Count, ct);
                foreach (var lease in leases) running.Add(RunAsync(lease, ct));
            }
        }
        // Only a completed discovery and claim pass is productive; liveness alone is not health.
        await HeartbeatAsync(ct);
    }

    private async Task HeartbeatAsync(CancellationToken ct)
    {
        var file = options.HeartbeatFile;
        try
        {
            var now = time.GetUtcNow();
            // "<unix seconds> <timeout seconds>": the health script needs no configuration of its own.
            // No secrets or account information in this file.
            var temporary = file + "." + workerId + ".new";
            await File.WriteAllTextAsync(temporary, string.Create(CultureInfo.InvariantCulture,
                $"{now.ToUnixTimeSeconds()} {(long)options.HeartbeatTimeout.TotalSeconds}"), ct);
            File.Move(temporary, file, overwrite: true);
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IMonitorStore>().RecordHeartbeatAsync(workerId, now, ct);
        }
        catch
        {
            // Neither the container nor the API may report a worker healthy whose heartbeat cannot be recorded.
            try { File.Delete(file); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            throw;
        }
    }

    private async Task RunAsync(MonitorLease lease, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<MonitorRunExecutor>().RunAsync(lease, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception error)
        {
            logger.LogWarning("Monitor run {RequestId} for account {AccountId} failed with {ErrorType}. Lease recovery will retry it.",
                lease.RequestId, lease.AccountId, error.GetType().Name);
        }
    }
}
