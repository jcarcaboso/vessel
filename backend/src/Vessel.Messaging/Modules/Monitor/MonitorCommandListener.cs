using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vessel.Application.Events;
using Vessel.Application.Ownership;

namespace Vessel.Messaging.Modules.Monitor;

/// <summary>
/// The inline listener behind <c>{prefix}.commands.monitor</c>. It validates the owner before resolving anything
/// owner-scoped, then hands the command to the module's Application handler. Unknown owners dead-letter;
/// suspended owners are acknowledged without starting work.
/// </summary>
public sealed class MonitorCommandListener
{
    public static async Task Handle(MonitorAccountCommand command, IOwnerScopeFactory scopes, IJournalOwnerDirectory owners,
        ILogger<MonitorCommandListener> logger, CancellationToken cancellationToken)
    {
        var status = await owners.StatusAsync(command.OwnerId, cancellationToken);
        if (command.OwnerId == Guid.Empty || command.RequestId == Guid.Empty || command.AccountId == Guid.Empty ||
            status == JournalOwnerStatus.Unknown)
        {
            logger.LogWarning("Monitor command {RequestId} for account {AccountId} names unknown owner {OwnerId} or invalid IDs; dead-lettering.",
                command.RequestId, command.AccountId, command.OwnerId);
            throw new CommandDeadLetterException("invalid owner");
        }
        if (status != JournalOwnerStatus.Active)
        {
            logger.LogInformation("Monitor command {RequestId} for suspended owner {OwnerId} was dropped.", command.RequestId, command.OwnerId);
            return;
        }
        await using var scope = scopes.Create(command.OwnerId);
        await scope.Services.GetRequiredService<IVesselCommandHandler<MonitorAccountCommand>>()
            .HandleAsync(command, cancellationToken);
    }
}
