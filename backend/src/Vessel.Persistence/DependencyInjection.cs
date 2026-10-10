using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

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
            options.UseNpgsql(connection).ConfigureWarnings(warnings => warnings.Log(
                // These Error events embed exception text, the database name and host:port.
                // The API records request failures with a safe event, so keep them at Debug.
                (RelationalEventId.ConnectionError, LogLevel.Debug),
                (RelationalEventId.CommandError, LogLevel.Debug),
                (RelationalEventId.TransactionError, LogLevel.Debug),
                (CoreEventId.QueryIterationFailed, LogLevel.Debug),
                (CoreEventId.SaveChangesFailed, LogLevel.Debug)));
        });
        services.AddScoped<Vessel.Application.Workspace.IWorkspaceStore, WorkspaceStore>();
        services.AddScoped<Vessel.Application.Workspace.WorkspaceService>();
        services.AddScoped<Vessel.Application.Workspace.AccountDiscoveryService>();
        services.AddScoped<Vessel.Application.Credentials.IAccountCredentialStore, AccountCredentialStore>();
        services.AddScoped<Vessel.Application.Credentials.AccountCredentialService>();
        services.AddScoped<Vessel.Application.Credentials.AccountCredentialReader>();
        // The venue registry is also used by database-free system metadata. Delay DB resolution
        // until an adapter actually reads a credential, retaining the request's scoped context.
        services.AddScoped<Vessel.Application.Credentials.IAccountCredentialReader>(sp =>
            new DeferredAccountCredentialReader(() => sp.GetRequiredService<Vessel.Application.Credentials.AccountCredentialReader>()));
        services.AddScoped<Vessel.Application.Evidence.IEvidenceMetadataStore, EvidenceStore>();
        services.AddScoped<Vessel.Application.Evidence.EvidenceService>();
        services.AddScoped<Vessel.Application.Plays.IPlayStore, PlayStore>();
        services.AddScoped<Vessel.Application.Plays.PlayService>();
        services.AddScoped<Vessel.Application.Plays.Execution.IPlayExecutionStore, ExecutionStore>();
        services.AddScoped<Vessel.Application.Plays.Execution.PlayExecutionService>();
        services.AddScoped<Vessel.Application.Sizing.ISizingStore, SizingStore>();
        services.AddScoped<Vessel.Application.Sizing.SizingService>();
        services.AddScoped<Vessel.Application.Review.IReviewStore, ReviewStore>();
        services.AddScoped<Vessel.Application.Review.ReviewService>();
        services.AddScoped<Vessel.Application.MarketData.CandleService>();
        services.AddScoped<Vessel.Application.MarketData.MarketContextService>();
        services.AddScoped<Vessel.Application.MarketData.MarketStreamService>();
        return services;
    }
}

internal sealed class DeferredAccountCredentialReader(Func<Vessel.Application.Credentials.AccountCredentialReader> reader)
    : Vessel.Application.Credentials.IAccountCredentialReader
{
    public Task<string?> ReadAsync(Guid accountId, CancellationToken cancellationToken) =>
        reader().ReadAsync(accountId, cancellationToken);

    public Task<bool> IsUsableAsync(Vessel.Domain.Accounts.Account account, CancellationToken cancellationToken) =>
        reader().IsUsableAsync(account, cancellationToken);
}
