using Vessel.Application.Events;

namespace Vessel.Application.Monitoring;

/// <summary>Lets an accepted command start the scheduler's next pass early. The default does nothing.</summary>
public interface IMonitorWakeup
{
    void Wake();
}

public sealed class NoMonitorWakeup : IMonitorWakeup
{
    public void Wake() { }
}

/// <summary>
/// <c>RunAccountMonitor</c> behind the command queue, after the listener validated the owner. The pending request in
/// <c>monitor_accounts</c> and its request ID are the durable hand-off and dedup: a matching pending request wakes the
/// scheduler, and anything else (a duplicate, a delayed command, a request a scheduled run already covered, a deleted
/// account) is simply acknowledged. Venue polling belongs to the scheduler and run executor, never this handler.
/// </summary>
public sealed class MonitorCommandHandler(IMonitorStore store, IMonitorWakeup wakeup) : IVesselCommandHandler<MonitorAccountCommand>
{
    public async Task HandleAsync(MonitorAccountCommand command, CancellationToken cancellationToken)
    {
        var row = await store.FindAsync(command.AccountId, cancellationToken);
        if (row is { ManualState: "pending" } && row.RequestId == command.RequestId) wakeup.Wake();
    }
}
