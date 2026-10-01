using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Vessel.Infrastructure.Auth;

public sealed class BearerTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> schemes,
    ILoggerFactory logger, UrlEncoder encoder, IOptions<VesselAuthOptions> auth)
    : AuthenticationHandler<AuthenticationSchemeOptions>(schemes, logger, encoder)
{
    public const string SchemeName = "VesselBearer";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var settings = auth.Value;
        if (string.IsNullOrWhiteSpace(settings.Token) || settings.OwnerId == Guid.Empty ||
            string.IsNullOrWhiteSpace(settings.OwnerName))
            return Task.FromResult(AuthenticateResult.Fail("Authentication is not configured."));

        if (!AuthenticationHeaderValue.TryParse(Request.Headers.Authorization, out var header) ||
            !string.Equals(header.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrEmpty(header.Parameter))
            return Task.FromResult(AuthenticateResult.NoResult());

        // Hash both values to compare fixed-size buffers without leaking token length.
        var supplied = SHA256.HashData(Encoding.UTF8.GetBytes(header.Parameter));
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(settings.Token));
        if (!CryptographicOperations.FixedTimeEquals(supplied, expected))
            return Task.FromResult(AuthenticateResult.Fail("Invalid bearer credentials."));

        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, settings.OwnerId.ToString()),
            new Claim(ClaimTypes.Name, settings.OwnerName)], SchemeName);
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = 401;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
