using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;

namespace Vessel.Infrastructure.Monitoring;

/// <summary>Logs a failed monitor run by request, account and trigger, with the exception type name only.</summary>
public sealed class MonitorRunLog(ILogger<MonitorRunLog> logger) : IMonitorRunLog
{
    public void Failed(MonitorLease lease, string errorType) =>
        logger.LogWarning("Monitor run {RequestId} ({Trigger}) for account {AccountId} failed with {ErrorType}.",
            lease.RequestId, lease.Trigger, lease.AccountId, errorType);
}

/// <summary>Renew through separate scopes so the read and its DbContext are never used concurrently.</summary>
public sealed class MonitorRunExecutor(IOwnerScopeFactory scopes, IJournalOwnerContext owner,
    MonitorCoordinator coordinator, TimeProvider time)
{
    /// <summary>
    /// The owner's account Refresh: the same admission gate and two-read budget as checks, then the run on the
    /// API's own lease. It never leaves work pending for the worker, and its outcome leaves check scheduling alone.
    /// </summary>
    /// <returns>False when the venue read failed or changed settings superseded it.</returns>
    public async Task<bool> RefreshAsync(Guid accountId, CancellationToken ct) =>
        await RunAsync(await coordinator.AdmitRefreshAsync(accountId, "api-" + Guid.NewGuid().ToString("N"), ct), ct);

    public async Task<bool> RunAsync(MonitorLease lease, CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var renewing = RenewAsync(lease, linked);
        try { return await coordinator.RunAsync(lease, linked.Token); }
        finally
        {
            await linked.CancelAsync();
            await renewing;
        }
    }

    private async Task RenewAsync(MonitorLease lease, CancellationTokenSource cancellation)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), time);
            while (await timer.WaitForNextTickAsync(cancellation.Token))
            {
                await using var scope = scopes.Create(owner.OwnerId);
                if (!await scope.Services.GetRequiredService<IMonitorStore>()
                    .RenewAsync(lease, time.GetUtcNow(), cancellation.Token))
                {
                    await cancellation.CancelAsync();
                    return;
                }
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch
        {
            // A lost database connection must cancel reads, never let a stale lease write.
            await cancellation.CancelAsync();
        }
    }
}
