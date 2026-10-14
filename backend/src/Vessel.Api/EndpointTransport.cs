using Microsoft.AspNetCore.Http.Metadata;
using Vessel.Application.Common;

namespace Vessel.Api;

/// <summary>
/// Marks a route whose request can carry a read-only venue token. Token-bearing methods need HTTPS outside Development
/// unless the request is loopback, and every response, errors included, is <c>no-store</c>.
/// </summary>
public sealed class CredentialEndpoint;

/// <summary>
/// Bounds the request body before model binding. Routing applies <see cref="MaxBytes"/> to the server's body-size limit,
/// which also stops chunked bodies; a larger declared Content-Length is refused first with <see cref="TooLargeMessage"/>.
/// </summary>
public sealed class RequestBodyLimit(long maxBytes, string tooLargeMessage) : IRequestSizeLimitMetadata
{
    public long MaxBytes => maxBytes;
    public string TooLargeMessage => tooLargeMessage;
    long? IRequestSizeLimitMetadata.MaxRequestBodySize => maxBytes;
}

/// <summary>Transport rules declared as endpoint metadata, so a new route cannot miss them by its path.</summary>
public static class EndpointTransport
{
    public const long CredentialBodyBytes = 4096;

    /// <summary>A route that carries a venue token: the HTTPS guard, <c>no-store</c> and a 4 KiB body.</summary>
    public static TBuilder CarriesCredential<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new CredentialEndpoint(), new RequestBodyLimit(CredentialBodyBytes, "Credential request is too large."));

    public static TBuilder WithBodyLimit<TBuilder>(this TBuilder builder, long maxBytes, string tooLargeMessage)
        where TBuilder : IEndpointConventionBuilder => builder.WithMetadata(new RequestBodyLimit(maxBytes, tooLargeMessage));

    public static bool IsCredentialEndpoint(this HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<CredentialEndpoint>() is not null;

    /// <summary>
    /// Applies the matched endpoint's transport metadata. Register after authorization, so a request without a valid
    /// bearer token gets 401 before any transport or size answer. Never reads or logs the body.
    /// </summary>
    public static void UseEndpointTransport(this WebApplication app) => app.Use(async (context, next) =>
    {
        var metadata = context.GetEndpoint()?.Metadata;
        if (metadata?.GetMetadata<CredentialEndpoint>() is not null)
        {
            context.Response.Headers.CacheControl = "no-store";
            // Local/LAN development may use HTTP. Every other environment retains the transport guard,
            // independently of the frontend build; headers and request bodies cannot enable this exception.
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsDelete(context.Request.Method) &&
                !app.Environment.IsDevelopment() &&
                !CredentialTransport.IsAllowed(context))
                throw new ProblemException(403, "Credential entry requires HTTPS outside localhost.");
        }
        // Routing has already applied the same limit to the server, which bounds chunked bodies during binding.
        if (metadata?.GetMetadata<IRequestSizeLimitMetadata>() is RequestBodyLimit limit && context.Request.ContentLength > limit.MaxBytes)
            throw new ProblemException(413, limit.TooLargeMessage);
        await next(context);
    });
}
