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
        // Venue modules register their descriptor and adapter ports; use cases find them by venue ID.
        // Catalogue caches hold public data only and outlive the scoped adapters.
        services.AddSingleton(VenueDescriptor.Manual);
        services.AddSingleton<HyperliquidCatalogueCache>();
        services.AddVenueModule<HyperliquidPerpetualReader>(HyperliquidPerpetualReader.Descriptor, client =>
        {
            client.BaseAddress = new Uri("https://api.hyperliquid.xyz/");
            client.Timeout = TimeSpan.FromSeconds(20);
        });
        // RISEx: public reads by address, no credential. The API's firewall rejects some default user agents.
        services.AddSingleton<RisexCatalogueCache>();
        services.AddVenueModule<RisexReader>(RisexReader.Descriptor, client =>
        {
            client.BaseAddress = new Uri("https://api.rise.trade/");
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("Vessel/1.0 (self-hosted trading journal; read-only)");
        });
        // Lighter: the read-only token is added per request by its own handler. No redirects, so Authorization
        // cannot leave the venue host.
        services.AddSingleton<LighterCatalogueCache>();
        services.AddVenueModule<LighterReader>(LighterReader.Descriptor, client =>
        {
            client.BaseAddress = new Uri("https://mainnet.zklighter.elliot.ai/");
            client.Timeout = TimeSpan.FromSeconds(20);
        }, builder => builder.AddHttpMessageHandler(() => new LighterAuthenticationHandler())
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false }));
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

    private static readonly Type[] VenuePorts =
    [
        typeof(IPerpetualVenueReader), typeof(IVenueOrderReader), typeof(ICandleReader), typeof(IMarketContextReader),
        typeof(IVenueAccountDiscovery), typeof(IVenueCredentialVerifier)
    ];

    /// <summary>
    /// Registers a venue module: its descriptor, one logger-free HttpClient named after the venue, and every venue port
    /// the adapter implements, forwarded to one adapter per scope. A later registration of a port wins in the registry.
    /// </summary>
    private static void AddVenueModule<TAdapter>(this IServiceCollection services, VenueDescriptor descriptor,
        Action<HttpClient> configureClient, Action<IHttpClientBuilder>? configureBuilder = null) where TAdapter : class
    {
        services.AddSingleton(descriptor);
        var name = descriptor.Id;
        var client = services.AddHttpClient(name, configureClient).RemoveAllLoggers();
        configureBuilder?.Invoke(client);
        var create = ActivatorUtilities.CreateFactory<TAdapter>([typeof(HttpClient)]);
        services.AddScoped(sp => create(sp, [sp.GetRequiredService<IHttpClientFactory>().CreateClient(name)]));
        foreach (var port in VenuePorts.Where(port => port.IsAssignableFrom(typeof(TAdapter))))
            services.AddScoped(port, sp => sp.GetRequiredService<TAdapter>());
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
