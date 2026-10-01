using System.Text.Json;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

public sealed partial class HyperliquidPerpetualReader : IMarketContextReader
{
    private const int MaxUniverse = 10_000;

    public Task<IReadOnlyList<VenueMarketContext>> ReadMarketContextsAsync(CancellationToken cancellationToken) =>
        ReadBoundedAsync<IReadOnlyList<VenueMarketContext>>(async token =>
        {
            using var response = await ReadJsonAsync(new { type = "metaAndAssetCtxs" }, token);
            return ReadMarketContexts(response.RootElement);
        }, cancellationToken);

    private static List<VenueMarketContext> ReadMarketContexts(JsonElement root)
    {
        if (Array(root).GetArrayLength() != 2)
            throw new VenueReadException(InvalidResponse);
        var universe = Array(Property(root[0], "universe"));
        var contexts = Array(root[1]);
        if (universe.GetArrayLength() > MaxUniverse || universe.GetArrayLength() != contexts.GetArrayLength())
            throw new VenueReadException(InvalidResponse);
        var names = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<VenueMarketContext>(universe.GetArrayLength());
        for (var i = 0; i < universe.GetArrayLength(); i++)
        {
            var name = Text(Property(universe[i], "name"));
            if (!names.Add(name))
                throw new VenueReadException(InvalidResponse);
            var ctx = contexts[i];
            var funding = Signed(Property(ctx, "funding"));
            var premium = Property(ctx, "premium");
            var mid = Property(ctx, "midPx");
            result.Add(new(name, Price(Property(ctx, "markPx")).Text, Price(Property(ctx, "oraclePx")).Text,
                mid.ValueKind == JsonValueKind.Null ? null : Price(mid).Text,
                Price(Property(ctx, "prevDayPx")).Text, Price(Property(ctx, "dayNtlVlm")).Text,
                Price(Property(ctx, "openInterest")).Text, funding,
                premium.ValueKind == JsonValueKind.Null ? null : Signed(premium)));
        }
        return result;
    }

    // Keeps the exact string after proving it is a finite decimal that may be negative.
    private static string Signed(JsonElement element)
    {
        Number(element);
        return element.GetString()!;
    }
}
