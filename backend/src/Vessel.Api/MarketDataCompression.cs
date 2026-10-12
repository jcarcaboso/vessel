using Microsoft.AspNetCore.ResponseCompression;

namespace Vessel.Api;

/// <summary>Only these explicitly marked, successful JSON reads may be compressed.</summary>
public sealed class CompressMarketData;

public sealed class MarketDataCompression(ResponseCompressionProvider provider) : IResponseCompressionProvider
{
    public bool CheckRequestAcceptsCompression(HttpContext context) => provider.CheckRequestAcceptsCompression(context);
    public ICompressionProvider? GetCompressionProvider(HttpContext context) => provider.GetCompressionProvider(context);
    public bool ShouldCompressResponse(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<CompressMarketData>() is not null &&
        context.Response.StatusCode is >= 200 and < 300 &&
        context.Response.ContentType?.Split(';')[0] == "application/json" &&
        provider.ShouldCompressResponse(context);
}
