using Microsoft.Extensions.Configuration;
using Vessel.Messaging.Modules.Monitor;
using Vessel.Messaging.Modules.Notifications;
using Vessel.Messaging.Modules.Verification;

namespace Vessel.Messaging.Modules;

/// <summary>The explicit list of compiled-in modules. There is no plugin discovery and no host-role switch.</summary>
public sealed class VesselModuleRegistry
{
    public VesselModuleRegistry(IEnumerable<IVesselModule> modules)
    {
        Modules = modules.ToArray();
        var names = Modules.Select(m => m.Name).ToArray();
        var subscriptions = Modules.SelectMany(m => m.Subscriptions).ToArray();
        var queues = Modules.SelectMany(m => m.Commands).ToArray();
        if (!names.All(MessagingNames.ValidName) || names.Contains("api") || names.Distinct(StringComparer.Ordinal).Count() != names.Length ||
            subscriptions.Select(s => s.Name).Distinct(StringComparer.Ordinal).Count() != subscriptions.Length ||
            Modules.Any(m => m.Subscriptions.Any(s => s.Module != m.Name)) ||
            !queues.All(q => MessagingNames.ValidName(q.Name)) ||
            queues.Select(q => q.Name).Distinct(StringComparer.Ordinal).Count() != queues.Length ||
            queues.Select(q => q.MessageType).Distinct().Count() != queues.Length)
            throw new InvalidOperationException("The compiled-in messaging modules are inconsistent.");
    }

    public IReadOnlyList<IVesselModule> Modules { get; }

    /// <summary>Compiled-in modules; the verification module only when <c>Vessel:Messaging:Verification</c> is set.</summary>
    public static VesselModuleRegistry From(MessagingSettings settings) =>
        new(settings.Verification ? [new MonitorModule(), new NotificationsModule(), new VerificationModule()]
            : [new MonitorModule(), new NotificationsModule()]);

    public static VesselModuleRegistry From(IConfiguration configuration) =>
        From(MessagingHosting.Settings(configuration));

    /// <summary>Resolves the modules a host runs. An unknown name stops startup.</summary>
    public IReadOnlyList<IVesselModule> Select(IEnumerable<string> names) => names.Distinct(StringComparer.Ordinal)
        .Select(name => Modules.SingleOrDefault(m => m.Name == name)
            ?? throw new InvalidOperationException($"Unknown messaging module '{(MessagingNames.ValidName(name) ? name : "?")}'."))
        .ToArray();
}
