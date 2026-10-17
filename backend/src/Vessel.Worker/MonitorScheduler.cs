using System.Globalization;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vessel.Application.Monitoring;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Monitoring;
using Vessel.Application.Ownership;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Vessel.Tests")]

namespace Vessel.Worker;

/// <summary>Coalesces command wake-ups into at most one early scheduling pass.</summary>
public sealed class MonitorWakeup : IMonitorWakeup
{
    private readonly Channel<bool> signals = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        { FullMode = BoundedChannelFullMode.DropWrite });
    private int pendingWaiters;
    public void Wake() => signals.Writer.TryWrite(true);

    /// <summary>Waiters created by <see cref="WaitAsync"/> that have not completed yet (diagnostics and tests).</summary>
    internal int PendingWaiters => Volatile.Read(ref pendingWaiters);

    /// <summary>
    /// A task that completes once a wake is available (or <paramref name="ct"/> is cancelled). Each call registers a
    /// channel waiter that stays until a wake or cancellation, so callers keep one across timer ticks.
    /// </summary>
    internal Task<bool> WaitAsync(CancellationToken ct)
    {
        var wait = signals.Reader.WaitToReadAsync(ct);
        if (wait.IsCompleted) return wait.AsTask();
        Interlocked.Increment(ref pendingWaiters);
        var task = wait.AsTask();
        _ = task.ContinueWith(static (_, state) => ((MonitorWakeup)state!).WaiterCompleted(), this,
            CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        return task;
    }

    internal void Consume() => signals.Reader.TryRead(out _);
    private void WaiterCompleted() => Interlocked.Decrement(ref pendingWaiters);
}

/// <summary>
/// The scheduler's loop: one pass at start, then one per timer tick, and one early pass when a wake arrives
/// (a wake during a pass causes exactly one more pass). The wake waiter is kept across timer ticks and replaced only
/// once it has completed, so timer-only ticks never accumulate channel waiters.
/// </summary>
internal static class MonitorSchedulerLoop
{
    public static async Task RunAsync(TimeProvider time, TimeSpan period, MonitorWakeup wakeup,
        Func<CancellationToken, Task> pass, Action<Exception> failed, CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(period, time);
        var tick = Task.FromResult(true);
        Task<bool>? wake = null;
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
                try { await pass(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception error) { failed(error); }
                // A waiter that completed before this pass's Consume() is stale: replace it. A fresh waiter completes
                // at once if a wake arrived during the pass, otherwise it waits (across timer ticks) for the next wake.
                if (wake is { IsCompleted: true }) wake = null;
                wake ??= wakeup.WaitAsync(stoppingToken);
                await Task.WhenAny(tick, wake);
                stoppingToken.ThrowIfCancellationRequested();
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}

/// <summary>
/// Every <see cref="MonitorOptions.SchedulerTick"/>, or early when a command arrives: discover accounts, claim due
/// rows and run at most two. The heartbeat row and file advance only after such a productive pass.
/// TimeProvider and registry are normal DI inputs, including in isolated integration hosts.
/// </summary>
public sealed class MonitorScheduler(IOwnerScopeFactory scopes, IJournalOwnerDirectory owners, TimeProvider time, MonitorOptions options,
    MonitorWakeup wakeup, ILogger<MonitorScheduler> logger) : BackgroundService
{
    private readonly string workerId = Guid.NewGuid().ToString("N");
    private readonly List<Task> running = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await MonitorSchedulerLoop.RunAsync(time, MonitorOptions.SchedulerTick, wakeup, TickAsync,
                error => logger.LogWarning("Monitor scheduling failed with {ErrorType}. It will retry on the next tick.",
                    error.GetType().Name), stoppingToken);
        }
        finally { await Task.WhenAll(running); }
    }

    public async Task TickAsync(CancellationToken ct)
    {
        running.RemoveAll(t => t.IsCompleted);
        Guid? after = null;
        var productive = new List<Guid>();
        while (true)
        {
            var page = await owners.ActiveOwnersAsync(after, 100, ct);
            if (page.Count == 0) break;
            foreach (var owner in page)
            {
                after = owner;
                if (await owners.StatusAsync(owner, ct) != JournalOwnerStatus.Active) continue;
                await using var scope = scopes.Create(owner);
                var now = time.GetUtcNow();
                var venues = scope.Services.GetRequiredService<IVenueRegistry>();
                await scope.Services.GetRequiredService<MonitorCoordinator>().DiscoverAsync(venues.Descriptors
                    .Where(v => v.Capabilities is { Sync: true, Orders: true }).Select(v => v.Id).ToArray(), now, ct);
                if (running.Count < 2 && await owners.StatusAsync(owner, ct) == JournalOwnerStatus.Active)
                {
                    var leases = await scope.Services.GetRequiredService<IMonitorStore>()
                        .ClaimDueAsync(workerId, now, 2 - running.Count, ct);
                    foreach (var lease in leases) running.Add(RunAsync(owner, lease, ct));
                }
                productive.Add(owner);
            }
        }
        // Only a completed discovery and claim pass is productive; liveness alone is not health.
        await HeartbeatAsync(productive, ct);
    }

    private async Task HeartbeatAsync(IReadOnlyList<Guid> productive, CancellationToken ct)
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
            foreach (var owner in productive)
            {
                await using var scope = scopes.Create(owner);
                await scope.Services.GetRequiredService<IMonitorStore>().RecordHeartbeatAsync(workerId, now, ct);
            }
        }
        catch
        {
            // Neither the container nor the API may report a worker healthy whose heartbeat cannot be recorded.
            try { File.Delete(file); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            throw;
        }
    }

    private async Task RunAsync(Guid owner, MonitorLease lease, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.Create(owner);
            await scope.Services.GetRequiredService<MonitorRunExecutor>().RunAsync(lease, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception error)
        {
            logger.LogWarning("Monitor run {RequestId} for account {AccountId} failed with {ErrorType}. Lease recovery will retry it.",
                lease.RequestId, lease.AccountId, error.GetType().Name);
        }
    }
}
