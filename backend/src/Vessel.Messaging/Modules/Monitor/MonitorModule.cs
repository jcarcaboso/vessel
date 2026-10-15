using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Events;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Messaging.Modules.Monitor;

/// <summary>
/// The account monitor. Any host can request a run through <c>{prefix}.commands.monitor</c>; the run executor,
/// scheduler and command handler are added by the worker step. It owns no event subscription.
/// </summary>
public sealed class MonitorModule : IVesselModule
{
    public const string ModuleName = "monitor";
    public string Name => ModuleName;
    public IReadOnlyList<CommandQueue> Commands { get; } = [new("monitor", typeof(MonitorAccountCommand), typeof(MonitorCommandListener))];
    public IReadOnlyList<EventSubscription> Subscriptions { get; } = [];
    public void AddRunningServices(IServiceCollection services, IConfiguration configuration) { }
}
