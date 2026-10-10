using System.Net;

namespace Vessel.Api;

/// <summary>Token-bearing credential requests need HTTPS, except a direct loopback request to a loopback host.</summary>
internal static class CredentialTransport
{
    public static bool IsAllowed(HttpContext context)
    {
        if (context.Request.IsHttps) return true;
        // A plaintext proxy that forwards a LAN client keeps the LAN Host header (or its forwarded client address).
        var host = context.Request.Host.Host;
        var loopbackHost = string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
        // No peer address means an in-process or Unix-socket connection, which is local by construction.
        var peer = context.Connection.RemoteIpAddress;
        return loopbackHost && (peer is null || IPAddress.IsLoopback(peer));
    }
}
