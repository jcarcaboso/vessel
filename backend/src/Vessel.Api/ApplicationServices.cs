using Vessel.Application.Activity;
using Vessel.Application.Credentials;
using Vessel.Application.Evidence;
using Vessel.Application.MarketData;
using Vessel.Application.Overview;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Review;
using Vessel.Application.Sizing;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;

namespace Vessel.Api;

/// <summary>The use cases the API exposes. Persistence registers only the DbContext and the stores behind their ports.</summary>
public static class ApplicationServices
{
    public static IServiceCollection AddVesselApplication(this IServiceCollection services)
    {
        services.AddScoped<WorkspaceService>();
        services.AddScoped<ActivityService>();
        services.AddScoped<OverviewSummaryService>();
        services.AddScoped<AccountDiscoveryService>();
        services.AddScoped<AccountCredentialService>();
        services.AddScoped<AccountCredentialReader>();
        // The venue registry is also used by database-free system metadata. Delay DB resolution
        // until an adapter actually reads a credential, retaining the request's scoped context.
        services.AddScoped<IAccountCredentialReader>(sp =>
            new DeferredAccountCredentialReader(() => sp.GetRequiredService<AccountCredentialReader>()));
        services.AddScoped<EvidenceService>();
        services.AddScoped<PlayService>();
        services.AddScoped<DiaryService>();
        services.AddScoped<PlayExecutionService>();
        services.AddScoped<SizingService>();
        services.AddScoped<ReviewService>();
        services.AddScoped<CandleService>();
        services.AddScoped<MarketContextService>();
        services.AddScoped<MarketStreamService>();
        return services;
    }
}

internal sealed class DeferredAccountCredentialReader(Func<AccountCredentialReader> reader) : IAccountCredentialReader
{
    public Task<string?> ReadAsync(Guid accountId, CancellationToken cancellationToken) =>
        reader().ReadAsync(accountId, cancellationToken);

    public Task<bool> IsUsableAsync(Account account, CancellationToken cancellationToken) =>
        reader().IsUsableAsync(account, cancellationToken);

    public Task MarkRefusedAsync(Guid accountId, CancellationToken cancellationToken) =>
        reader().MarkRefusedAsync(accountId, cancellationToken);
}
