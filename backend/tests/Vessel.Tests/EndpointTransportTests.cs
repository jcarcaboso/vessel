using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Api;

namespace Vessel.Tests;

public sealed class EndpointTransportTests
{
    [Fact]
    public async Task Every_credential_route_carries_the_marker_and_the_credential_body_limit()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        var endpoints = Endpoints(factory);
        var credential = endpoints.Where(e => e.RoutePattern.RawText!.Contains("credential", StringComparison.OrdinalIgnoreCase)).ToList();

        Assert.Equal(
            ["DELETE /api/accounts/{id:guid}/credential", "GET /api/accounts/{id:guid}/credential",
             "POST /api/venues/{venueId}/accounts/credential", "PUT /api/accounts/{id:guid}/credential"],
            credential.Select(Name).Order(StringComparer.Ordinal));
        Assert.All(credential, endpoint =>
        {
            Assert.NotNull(endpoint.Metadata.GetMetadata<CredentialEndpoint>());
            // Routing applies the last size-limit metadata; it must be the credential limit.
            var limit = Assert.IsType<RequestBodyLimit>(endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>());
            Assert.Equal((4096L, "Credential request is too large."), (limit.MaxBytes, limit.TooLargeMessage));
        });
        // The marker never leaks onto routes that carry no token.
        Assert.DoesNotContain(endpoints.Except(credential), e => e.Metadata.GetMetadata<CredentialEndpoint>() is not null);
    }

    [Fact]
    public async Task Diary_writes_carry_their_body_limits()
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        var limits = Endpoints(factory)
            .Where(e => e.Metadata.GetMetadata<IRequestSizeLimitMetadata>() is RequestBodyLimit && e.Metadata.GetMetadata<CredentialEndpoint>() is null)
            .ToDictionary(Name, e => (RequestBodyLimit)e.Metadata.GetMetadata<IRequestSizeLimitMetadata>()!);

        Assert.Equal(
            ["POST /api/plays/retrospective", "POST /api/plays/{id:guid}/manual-executions",
             "PUT /api/plays/{id:guid}/manual-executions/{executionId:guid}"],
            limits.Keys.Order(StringComparer.Ordinal));
        Assert.All(limits, pair => Assert.Equal("Diary request is too large.", pair.Value.TooLargeMessage));
        Assert.Equal(131_072, limits["POST /api/plays/retrospective"].MaxBytes);
        Assert.Equal(16_384, limits["POST /api/plays/{id:guid}/manual-executions"].MaxBytes);
        Assert.Equal(16_384, limits["PUT /api/plays/{id:guid}/manual-executions/{executionId:guid}"].MaxBytes);
    }

    [Theory]
    [InlineData("POST", "/api/venues/index-fixture/accounts/credential")]
    [InlineData("PUT", "/api/accounts/11111111-1111-1111-1111-111111111111/credential")]
    public async Task Chunked_credential_bodies_are_bounded_during_binding(string method, string path)
    {
        await using var factory = new CoreApiFactory(Guid.NewGuid());
        // TestServer does not enforce the server's chunked request-body limit.
        factory.UseKestrel(0);
        using var client = factory.AuthorizedClient();
        var body = Encoding.UTF8.GetBytes(new string(' ', 4096) + "{}");
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = new ChunkedContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Headers.TransferEncodingChunked = true;

        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Empty(await response.Content.ReadAsStringAsync());
    }

    private static List<RouteEndpoint> Endpoints(CoreApiFactory factory) =>
        factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

    private static string Name(RouteEndpoint endpoint) =>
        $"{Assert.Single(endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()!.HttpMethods)} {endpoint.RoutePattern.RawText!.TrimEnd('/')}";

    private sealed class ChunkedContent(byte[] body) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(body).AsTask();

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }
}
