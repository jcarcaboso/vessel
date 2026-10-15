using Vessel.Application.Common;
using Vessel.Application.Events;
using Vessel.Application.Monitoring;
using Vessel.Persistence;

namespace Vessel.Worker;

/// <summary>Runs after the listener validated the owner; the request in <c>monitor_accounts</c> is the hand-off.</summary>
public sealed class MonitorAccountCommandHandler(IMonitorStore store, MonitorRunExecutor executor, TimeProvider time)
    : IVesselCommandHandler<MonitorAccountCommand>
{
    public async Task HandleAsync(MonitorAccountCommand command, CancellationToken ct)
    {
        MonitorLease? lease;
        try { lease = await store.ClaimAsync(command.AccountId, command.RequestId, "command-" + command.RequestId.ToString("N"), time.GetUtcNow(), ct); }
        catch (ProblemException ex) when (ex.StatusCode == 404) { return; }
        if (lease is not null) await executor.RunAsync(lease, ct);
        // Capacity exhaustion leaves the same durable pending request for the next scheduler tick.
    }
}
