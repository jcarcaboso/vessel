using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Vessel.Infrastructure.Credentials;
using Vessel.Infrastructure.Venues.Lighter;
using Vessel.Application.Evidence;
using Vessel.Application.MarketData;
using Vessel.Application.Ownership;
using Vessel.Infrastructure.Auth;
using Vessel.Infrastructure.Evidence;
using Vessel.Application.Venues;
using Vessel.Infrastructure.Venues.Hyperliquid;
using Vessel.Infrastructure.Venues.Risex;

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
        services.AddHttpClient<IVenueOrderReader, HyperliquidPerpetualReader>(client =>
        {
            client.BaseAddress = new Uri("https://api.hyperliquid.xyz/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }).RemoveAllLoggers();
        // Venue modules register their descriptor and adapters; use cases find them by venue ID.
        services.AddSingleton(VenueDescriptor.Manual);
        services.AddSingleton(HyperliquidPerpetualReader.Descriptor);
        AddRisex(services);
        AddLighter(services);
        services.AddScoped<IVenueRegistry, VenueRegistry>();
        services.AddSingleton<CandleCache>();
        services.AddSingleton<MarketContextCache>();
        services.AddSingleton<MarketStreamLimiter>();
        services.AddSingleton<IWebSocketTransportFactory, ClientWebSocketTransportFactory>();
        services.AddSingleton<IMarketStream, HyperliquidMarketStream>();
        AddEvidenceStorage(services, config);
        services.AddVesselCredentials(config);
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

    /// <summary>
    /// RISEx: public reads by address, no credential. The API's firewall rejects some default user agents. Clients are
    /// named per venue: a typed client's default name is its interface, so sharing it would mix base addresses.
    /// </summary>
    private static void AddRisex(IServiceCollection services)
    {
        services.AddSingleton(RisexReader.Descriptor);
        services.AddSingleton<RisexCatalogueCache>();
        static void Configure(HttpClient client)
        {
            client.BaseAddress = new Uri("https://api.rise.trade/");
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Vessel/1.0 (self-hosted trading journal; read-only)");
        }
        services.AddHttpClient<IPerpetualVenueReader, RisexReader>("risex-IPerpetualVenueReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<IVenueOrderReader, RisexReader>("risex-IVenueOrderReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<ICandleReader, RisexReader>("risex-ICandleReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<IMarketContextReader, RisexReader>("risex-IMarketContextReader", Configure).RemoveAllLoggers();
    }

    private static void AddLighter(IServiceCollection services)
    {
        services.AddSingleton(LighterReader.Descriptor);
        services.AddHttpClient<LighterReader>("lighter", client =>
        {
            client.BaseAddress = new Uri("https://mainnet.zklighter.elliot.ai/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }).AddHttpMessageHandler(() => new LighterAuthenticationHandler())
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
            .RemoveAllLoggers();
        services.AddScoped<IPerpetualVenueReader>(sp => sp.GetRequiredService<LighterReader>());
        services.AddScoped<IVenueOrderReader>(sp => sp.GetRequiredService<LighterReader>());
        services.AddScoped<ICandleReader>(sp => sp.GetRequiredService<LighterReader>());
        services.AddScoped<IVenueAccountDiscovery>(sp => sp.GetRequiredService<LighterReader>());
        services.AddScoped<IVenueCredentialVerifier>(sp => sp.GetRequiredService<LighterReader>());
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
