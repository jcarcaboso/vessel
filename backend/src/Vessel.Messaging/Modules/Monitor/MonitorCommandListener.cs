using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vessel.Application.Events;

namespace Vessel.Messaging.Modules.Monitor;

/// <summary>
/// The inline listener behind <c>{prefix}.commands.monitor</c>. It validates the owner before resolving anything
/// owner-scoped, then hands the command to the module's Application handler. A command naming another owner is
/// dead-lettered and logged by IDs; it is never silently acknowledged.
/// </summary>
public sealed class MonitorCommandListener
{
    public static async Task Handle(MonitorAccountCommand command, MessagingHost host, IServiceScopeFactory scopes,
        ILogger<MonitorCommandListener> logger, CancellationToken cancellationToken)
    {
        if (command.OwnerId != host.OwnerId || command.RequestId == Guid.Empty || command.AccountId == Guid.Empty)
        {
            logger.LogWarning("Monitor command {RequestId} for account {AccountId} names owner {OwnerId}, not the configured owner; dead-lettering.",
                command.RequestId, command.AccountId, command.OwnerId);
            throw new CommandDeadLetterException("invalid owner");
        }
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IVesselCommandHandler<MonitorAccountCommand>>()
            .HandleAsync(command, cancellationToken);
    }
}
