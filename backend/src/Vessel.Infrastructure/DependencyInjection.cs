using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Vessel.Application.Evidence;
using Vessel.Application.MarketData;
using Vessel.Application.Ownership;
using Vessel.Infrastructure.Auth;
using Vessel.Infrastructure.Evidence;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddVesselInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<VesselAuthOptions>(config.GetSection("Vessel:Auth"));
        services.AddSingleton(TimeProvider.System);
        services.AddHttpClient<IPerpetualVenueReader, HyperliquidPerpetualReader>(client =>
        {
            client.BaseAddress = new Uri("https://api.hyperliquid.xyz/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }).RemoveAllLoggers();
        services.AddHttpClient<ICandleReader, HyperliquidPerpetualReader>(client =>
        {
            client.BaseAddress = new Uri("https://api.hyperliquid.xyz/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }).RemoveAllLoggers();
        services.AddHttpClient<IMarketContextReader, HyperliquidPerpetualReader>(client =>
        {
            client.BaseAddress = new Uri("https://api.hyperliquid.xyz/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }).RemoveAllLoggers();
        services.AddSingleton<CandleCache>();
        services.AddSingleton<MarketContextCache>();
        services.AddSingleton<MarketStreamLimiter>();
        services.AddSingleton<IWebSocketTransportFactory, ClientWebSocketTransportFactory>();
        services.AddSingleton<IMarketStream, HyperliquidMarketStream>();
        AddEvidenceStorage(services, config);
        services.AddHttpContextAccessor();
        services.AddScoped<IJournalOwnerContext, HttpJournalOwnerContext>();
        services.AddAuthentication(BearerTokenHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, BearerTokenHandler>(BearerTokenHandler.SchemeName, _ => { });
        services.AddAuthorization(options =>
        {
            // New endpoints are private unless they explicitly opt out, such as liveness.
            options.FallbackPolicy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
        });
        return services;
    }

    private static void AddEvidenceStorage(IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<EvidenceSettings>().Bind(config.GetSection(EvidenceSettings.Section))
            .Validate(s => s.MaxUploadBytes > 0 && s.MaxPerPlay > 0, "Vessel:Evidence limits must be positive.")
            // Fail at startup rather than on the first upload. Further providers (S3-compatible) plug in here.
            .Validate(s => s.Storage.Provider == EvidenceSettings.LocalProvider,
                "Vessel:Evidence:Storage:Provider must be Local; other storage providers are not available yet.")
            .Validate(s => !string.IsNullOrWhiteSpace(s.Storage.Local.RootPath), "Vessel:Evidence:Storage:Local:RootPath is required.")
            .ValidateOnStart();
        services.AddSingleton(sp =>
        {
            var settings = sp.GetRequiredService<IOptions<EvidenceSettings>>().Value;
            return new EvidenceLimits(settings.MaxUploadBytes, settings.MaxPerPlay);
        });
        services.AddSingleton<IEvidenceObjectStore>(sp =>
        {
            var settings = sp.GetRequiredService<IOptions<EvidenceSettings>>().Value.Storage;
            var contentRoot = sp.GetRequiredService<IHostEnvironment>().ContentRootPath;
            return new LocalEvidenceObjectStore(Path.GetFullPath(settings.Local.RootPath, contentRoot));
        });
    }
}
