using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Vessel.Infrastructure.Credentials;
using Vessel.Infrastructure.Venues;
using Vessel.Infrastructure.Venues.Lighter;
using Vessel.Application.Credentials;
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
        AddVenueHosts(services, config);
        services.AddSingleton<HyperliquidCatalogueCache>();
        static void Hyperliquid(IServiceProvider sp, HttpClient client)
        {
            client.BaseAddress = Hosts(sp).BaseUri(nameof(VenueHostOptions.Hyperliquid));
            client.Timeout = TimeSpan.FromSeconds(20);
        }
        services.AddHttpClient<IPerpetualVenueReader, HyperliquidPerpetualReader>(Hyperliquid).RemoveAllLoggers();
        services.AddHttpClient<ICandleReader, HyperliquidPerpetualReader>(Hyperliquid).RemoveAllLoggers();
        services.AddHttpClient<IMarketContextReader, HyperliquidPerpetualReader>(Hyperliquid).RemoveAllLoggers();
        services.AddHttpClient<IVenueOrderReader, HyperliquidPerpetualReader>(Hyperliquid).RemoveAllLoggers();
        // Venue modules register their descriptor and adapters; use cases find them by venue ID.
        services.AddSingleton(VenueDescriptor.Manual);
        services.AddSingleton(HyperliquidPerpetualReader.Descriptor);
        AddRisex(services);
        foreach (var exchange in LighterExchange.All) AddLighter(services, exchange);
        services.AddScoped<IVenueRegistry, VenueRegistry>();
        services.AddSingleton<CandleCache>();
        services.AddSingleton<MarketContextCache>();
        services.AddSingleton<MarketStreamLimiter>();
        services.AddSingleton<IWebSocketTransportFactory, ClientWebSocketTransportFactory>();
        services.AddSingleton<IMarketStream>(sp => new HyperliquidMarketStream(sp.GetRequiredService<IWebSocketTransportFactory>(),
            sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<ILogger<HyperliquidMarketStream>>(),
            Hosts(sp).StreamUri(nameof(VenueHostOptions.Hyperliquid))));
        AddEvidenceStorage(services, config);
        services.AddVesselCredentials(config);
        services.AddHttpContextAccessor();
        services.AddScoped<IJournalOwnerContext, HttpJournalOwnerContext>();
        services.AddSingleton<AuthFailureLimiter>();
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
        static void Configure(IServiceProvider sp, HttpClient client)
        {
            client.BaseAddress = Hosts(sp).BaseUri(nameof(VenueHostOptions.Risex));
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Vessel/1.0 (self-hosted trading journal; read-only)");
        }
        services.AddHttpClient<IPerpetualVenueReader, RisexReader>("risex-IPerpetualVenueReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<IVenueOrderReader, RisexReader>("risex-IVenueOrderReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<ICandleReader, RisexReader>("risex-ICandleReader", Configure).RemoveAllLoggers();
        services.AddHttpClient<IMarketContextReader, RisexReader>("risex-IMarketContextReader", Configure).RemoveAllLoggers();
    }

    /// <summary>
    /// Venue hosts are configuration (<c>Vessel:Venues</c>), validated at startup so a bad value fails fast and the
    /// message names only the key. Defaults are the production hosts.
    /// </summary>
    private static void AddVenueHosts(IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<VenueHostOptions>().Bind(config.GetSection(VenueHostOptions.Section)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<VenueHostOptions>, VenueHostValidation>();
    }

    private static VenueHostOptions Hosts(IServiceProvider sp) => sp.GetRequiredService<IOptions<VenueHostOptions>>().Value;

    /// <summary>
    /// One Lighter exchange: its own descriptor, named client (authentication handler, no redirects so Authorization
    /// cannot leave the host, 20 s), catalogue cache and reader. Each port is registered once per exchange, so the
    /// registry and the per-venue lookups find exactly one adapter for each venue ID.
    /// </summary>
    private static void AddLighter(IServiceCollection services, LighterExchange exchange)
    {
        var id = exchange.VenueId;
        services.AddSingleton(exchange.Descriptor);
        services.AddKeyedSingleton(id, (sp, _) => new LighterCatalogueCache(sp.GetRequiredService<TimeProvider>(), id));
        services.AddHttpClient(exchange.ClientName, (sp, client) =>
        {
            client.BaseAddress = Hosts(sp).BaseUri(exchange.HostSection);
            client.Timeout = TimeSpan.FromSeconds(20);
        }).AddHttpMessageHandler(() => new LighterAuthenticationHandler(exchange.Name))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
            .RemoveAllLoggers();
        services.AddKeyedScoped(id, (sp, _) => new LighterReader(
            sp.GetRequiredService<IHttpClientFactory>().CreateClient(exchange.ClientName), sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<IAccountCredentialReader>(), sp.GetRequiredKeyedService<LighterCatalogueCache>(id), exchange));
        services.AddScoped<IPerpetualVenueReader>(sp => sp.GetRequiredKeyedService<LighterReader>(id));
        services.AddScoped<IVenueOrderReader>(sp => sp.GetRequiredKeyedService<LighterReader>(id));
        services.AddScoped<ICandleReader>(sp => sp.GetRequiredKeyedService<LighterReader>(id));
        services.AddScoped<IVenueAccountDiscovery>(sp => sp.GetRequiredKeyedService<LighterReader>(id));
        services.AddScoped<IVenueCredentialVerifier>(sp => sp.GetRequiredKeyedService<LighterReader>(id));
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
