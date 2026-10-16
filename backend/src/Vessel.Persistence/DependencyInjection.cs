using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Vessel.Persistence;

public sealed class MissingDatabaseConfigurationException()
    : InvalidOperationException("ConnectionStrings__Vessel is required for persistence.");

public static class DependencyInjection
{
    public static IServiceCollection AddVesselPersistence(this IServiceCollection services, IConfiguration config)
    {
        // Resolve only when persistence is consumed. Metadata and liveness do not open a database.
        services.AddDbContext<VesselDbContext>(options =>
        {
            var connection = config.GetConnectionString("Vessel");
            if (string.IsNullOrWhiteSpace(connection))
                throw new MissingDatabaseConfigurationException();
            options.UseNpgsql(connection).ConfigureWarnings(warnings => warnings.Log(
                // These Error events embed exception text, the database name and host:port.
                // The API records request failures with a safe event, so keep them at Debug.
                (RelationalEventId.ConnectionError, LogLevel.Debug),
                (RelationalEventId.CommandError, LogLevel.Debug),
                (RelationalEventId.TransactionError, LogLevel.Debug),
                (CoreEventId.QueryIterationFailed, LogLevel.Debug),
                (CoreEventId.SaveChangesFailed, LogLevel.Debug)));
        });
        services.AddScoped<UnitOfWork>();
        services.AddScoped<Vessel.Application.Ownership.IUnitOfWork>(sp => sp.GetRequiredService<UnitOfWork>());
        services.AddScoped<Vessel.Application.Workspace.IWorkspaceStore, WorkspaceStore>();
        services.AddScoped<Vessel.Application.Activity.IActivityStore, ActivityStore>();
        services.AddScoped<Vessel.Application.Credentials.IAccountCredentialStore, AccountCredentialStore>();
        services.AddScoped<Vessel.Application.Evidence.IEvidenceMetadataStore, EvidenceStore>();
        services.AddScoped<Vessel.Application.Plays.IPlayStore, PlayStore>();
        services.AddScoped<Vessel.Application.Plays.IDiaryStore, DiaryStore>();
        services.AddScoped<Vessel.Application.Plays.Execution.IPlayExecutionStore, ExecutionStore>();
        services.AddScoped<Vessel.Application.Sizing.ISizingStore, SizingStore>();
        services.AddScoped<Vessel.Application.Review.IReviewStore, ReviewStore>();
        return services;
    }
}
