using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Ownership;
using Vessel.Infrastructure.Auth;
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
}
