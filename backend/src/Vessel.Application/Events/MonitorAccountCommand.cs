namespace Vessel.Application.Events;

public sealed record MonitorAccountCommand(Guid RequestId, Guid AccountId, Guid OwnerId, string Trigger);

public interface IMonitorCommandSink
{
    /// <summary>Persist the command in the API admission transaction; never dispatch before commit.</summary>
    Task EnqueueAsync(MonitorAccountCommand command, CancellationToken cancellationToken);
}
