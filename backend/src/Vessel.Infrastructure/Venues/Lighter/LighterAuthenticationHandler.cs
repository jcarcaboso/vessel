using System.Net;
using System.Text.Json;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Lighter;

/// <summary>
/// Register on the Lighter named HttpClient before BoundedJsonHttp discards error status/body.
/// This exposes only the refusal category, never a venue error body or Authorization value.
/// </summary>
public sealed class LighterAuthenticationHandler : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);
        try
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden ||
                response.StatusCode == HttpStatusCode.BadRequest && await AuthErrorAsync(response, cancellationToken))
                throw new LighterAuthenticationException();
            return response;
        }
        catch { response.Dispose(); throw; }
    }

    private static async Task<bool> AuthErrorAsync(HttpResponseMessage response, CancellationToken ct)
    {
        // The live API also returns HTTP400 for missing/invalid auth. Only classify known auth codes;
        // never turn unrelated invalid-parameter or financial schema errors into successful empty history.
        const int limit = 8192;
        if (response.Content.Headers.ContentLength > limit) return false;
        using var stream = await response.Content.ReadAsStreamAsync(ct);
        var bytes = new byte[limit + 1];
        var length = 0;
        while (length < bytes.Length)
        {
            var read = await stream.ReadAsync(bytes.AsMemory(length), ct);
            if (read == 0) break;
            length += read;
        }
        if (length > limit) return false;
        try
        {
            using var document = JsonDocument.Parse(bytes.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 8 });
            new StrictJson("Lighter returned an invalid error response.").RejectDuplicateProperties(document.RootElement);
            return IsAuthenticationError(document.RootElement);
        }
        catch (JsonException) { return false; }
    }

    internal static bool IsAuthenticationError(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("code", out var code) ||
            code.ValueKind != JsonValueKind.Number || !code.TryGetInt32(out var number)) return false;
        if (number is 401 or 403 or 20013 or 61005 or 61006) return true;
        return number == 20001 && root.TryGetProperty("message", out var message) &&
            message.ValueKind == JsonValueKind.String &&
            message.GetString() == "invalid param : auth query param and Authorization header are empty";
    }
}

internal sealed class LighterAuthenticationException() : Exception("Lighter refused access to this account history.");
