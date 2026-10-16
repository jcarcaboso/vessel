using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Events;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Messaging.Modules.Verification;

/// <summary>
/// Opt-in subscription <c>verification</c> to every event, for release checks and tests: provision it, prove
/// delivery and catch-up from its receipts, then deregister it. It is not a production consumer.
/// </summary>
public sealed class VerificationModule : IVesselModule
{
    public const string ModuleName = "verification";
    public const string SubscriptionName = "verification";
    public string Name => ModuleName;
    public IReadOnlyList<CommandQueue> Commands { get; } = [];
    public IReadOnlyList<EventSubscription> Subscriptions { get; } = [new(SubscriptionName, ModuleName, ["#"])];

    public void AddRunningServices(IServiceCollection services, IConfiguration configuration) =>
        services.AddKeyedScoped<IVesselEventSubscriber, VerificationSubscriber>(SubscriptionName);
}

/// <summary>No effects: the settled receipt is the evidence.</summary>
internal sealed class VerificationSubscriber : IVesselEventSubscriber
{
    public Task<EventHandling> HandleAsync(VesselEvent message, CancellationToken cancellationToken) =>
        Task.FromResult(EventHandling.Delivered);
}
