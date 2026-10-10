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
    ILoggerFactory logger, UrlEncoder encoder, IOptions<VesselAuthOptions> auth, AuthFailureLimiter limiter)
    : AuthenticationHandler<AuthenticationSchemeOptions>(schemes, logger, encoder)
{
    public const string SchemeName = "VesselBearer";
    private const string RetryAfterKey = "Vessel.Auth.RetryAfter";

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
        {
            // The right token always works, so a shared or unforwarded proxy address cannot be used to lock the
            // owner out; repeated wrong tokens are answered with 429 to slow guessing and flag the client.
            var address = Context.Connection.RemoteIpAddress;
            if (limiter.Blocked(address) is { } wait) Context.Items[RetryAfterKey] = wait;
            else limiter.RecordFailure(address);
            return Task.FromResult(AuthenticateResult.Fail("Invalid bearer credentials."));
        }

        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, settings.OwnerId.ToString()),
            new Claim(ClaimTypes.Name, settings.OwnerName)], SchemeName);
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        if (Context.Items[RetryAfterKey] is TimeSpan wait)
        {
            Response.StatusCode = 429;
            Response.Headers.RetryAfter = Math.Ceiling(wait.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Task.CompletedTask;
        }
        Response.StatusCode = 401;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
