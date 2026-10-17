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
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<NotificationStore>();
        services.TryAddScoped<INotificationHubStore>(sp => sp.GetRequiredService<NotificationStore>());
        services.TryAddScoped<INotificationStore>(sp => sp.GetRequiredService<NotificationStore>());
        services.TryAddScoped<NotificationService>();
        return services;
    }
}
