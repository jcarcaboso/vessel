using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Vessel.Api;

public static class ForwardedHeadersConfiguration
{
    public static void Configure(ForwardedHeadersOptions options, IConfiguration configuration)
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        var section = configuration.GetSection("Vessel:ForwardedHeaders");
        // Explicit trust replaces the framework's loopback defaults. Compose trusts
        // only its pinned web peer, not the bridge gateway or another container.
        if (section.GetSection("KnownNetworks").GetChildren().Any() ||
            section.GetSection("KnownProxies").GetChildren().Any())
        {
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
        }
        foreach (var entry in section.GetSection("KnownNetworks").GetChildren())
        {
            if (entry.Value is not { } value || !value.Contains('/') ||
                !System.Net.IPNetwork.TryParse(value, out var network) || network.PrefixLength == 0)
                throw new InvalidOperationException("Vessel:ForwardedHeaders:KnownNetworks must contain explicit, non-global CIDR networks.");
            options.KnownIPNetworks.Add(network);
        }
        foreach (var entry in section.GetSection("KnownProxies").GetChildren())
        {
            if (!IPAddress.TryParse(entry.Value, out var address) || address.Equals(IPAddress.Any) ||
                address.Equals(IPAddress.IPv6Any))
                throw new InvalidOperationException("Vessel:ForwardedHeaders:KnownProxies must contain explicit IP addresses.");
            options.KnownProxies.Add(address);
        }
        if (section["ForwardLimit"] is { } limit)
        {
            if (!int.TryParse(limit, out var count) || count is < 1 or > 5)
                throw new InvalidOperationException("Vessel:ForwardedHeaders:ForwardLimit must be between 1 and 5.");
            options.ForwardLimit = count;
        }
    }
}
