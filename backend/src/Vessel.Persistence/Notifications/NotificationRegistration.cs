using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Vessel.Application.Notifications;

namespace Vessel.Persistence.Notifications;

public static class NotificationRegistration
{
    /// <summary>
    /// <c>Vessel:Notifications</c>, the store and the owner use cases. The API and the notifications worker validate
    /// the same section; the hub handler itself is registered by the module that runs it.
    /// </summary>
    public static IServiceCollection AddVesselNotifications(this IServiceCollection services, IConfiguration configuration)
    {
        var options = new NotificationOptions();
        configuration.GetSection(NotificationOptions.Section).Bind(options);
        options.MonitorInterval = configuration.GetValue<TimeSpan?>("Vessel:Monitor:Interval") ?? options.MonitorInterval;
        options.Validate();
        services.TryAddSingleton(options);
        var deployments = configuration.GetSection("Vessel:Messaging:Deployments").GetChildren().ToArray();
        services.TryAddSingleton(new NotificationDeployments(deployments.Length == 0 ? ["notifications"] : deployments
            .Where(d => d.GetChildren().Any(m => m.Value == "notifications")).Select(d => d.Key).ToArray()));
        services.TryAddSingleton<NotificationWorkerState>();
        services.TryAddSingleton<SystemNotificationStore>();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<NotificationStore>();
        services.TryAddScoped<INotificationHubStore>(sp => sp.GetRequiredService<NotificationStore>());
        services.TryAddScoped<INotificationStore>(sp => sp.GetRequiredService<NotificationStore>());
        services.TryAddScoped<NotificationService>();
        return services;
    }
}
