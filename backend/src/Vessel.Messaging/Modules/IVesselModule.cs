using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Persistence.Events.Subscriptions;

namespace Vessel.Messaging.Modules;

/// <summary>
/// A feature module's messaging declaration. Every host applies the publishing side (command routes and topology
/// names); only a host that runs the module adds its listeners, handlers and hosted services. Provisioning declares
/// every known module's topology and registers its subscriptions, whichever modules a deployment runs.
/// </summary>
public interface IVesselModule
{
    /// <summary>Module name; also the default logical deployment and envelope schema of a host that runs it.</summary>
    string Name { get; }
    /// <summary>Point-to-point command queues this module owns.</summary>
    IReadOnlyList<CommandQueue> Commands { get; }
    /// <summary>Event subscriptions this module owns. Their handlers are registered by <see cref="AddRunningServices"/>.</summary>
    IReadOnlyList<EventSubscription> Subscriptions { get; }
    /// <summary>Services needed only by a host that runs this module, such as keyed subscription handlers.</summary>
    void AddRunningServices(IServiceCollection services, IConfiguration configuration);
}

/// <summary>
/// A command queue <c>{prefix}.commands.{Name}</c> and the message type routed to it. A host that runs the module
/// listens inline with <paramref name="Handler"/>, a handler class this project adapts to an Application port.
/// </summary>
public sealed record CommandQueue(string Name, Type MessageType, Type? Handler = null);
