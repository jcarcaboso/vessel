using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Vessel.Persistence;

public static class DependencyInjection
{
    public static IServiceCollection AddVesselPersistence(this IServiceCollection services, IConfiguration config)
    {
        // Resolve only when persistence is consumed. Metadata and liveness do not open a database.
        services.AddDbContext<VesselDbContext>(options =>
        {
            var connection = config.GetConnectionString("Vessel");
            if (string.IsNullOrWhiteSpace(connection))
                throw new InvalidOperationException("ConnectionStrings__Vessel is required for persistence.");
            options.UseNpgsql(connection);
        });
        services.AddScoped<Vessel.Application.Workspace.IWorkspaceStore, WorkspaceStore>();
        services.AddScoped<Vessel.Application.Workspace.WorkspaceService>();
        return services;
    }
}
