using System.Text.Json;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

internal abstract record HyperliquidStreamMessage;

/// <summary>Pong, unsubscribe confirmations, venue errors and unknown channels: liveness only.</summary>
internal sealed record HyperliquidStreamControl(string Channel) : HyperliquidStreamMessage;

internal sealed record HyperliquidStreamAck(string Type, string Coin, string? Interval) : HyperliquidStreamMessage;

internal sealed record HyperliquidStreamCandles(IReadOnlyList<(string Coin, string Interval, VenueCandle Candle)> Candles)
    : HyperliquidStreamMessage;

internal sealed record HyperliquidStreamContext(VenueMarketContext Context) : HyperliquidStreamMessage;

public sealed partial class HyperliquidPerpetualReader
{
    // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
    // Observed October 2, 2026: activeAssetCtx values and candle o/h/l/c/v arrive as JSON strings,
    // candle data as one object. Numbers and arrays are also accepted; numbers keep their raw token text.
    private const int MaxStreamCandles = 5000;

    /// <summary>Parses one upstream WebSocket message with the REST readers' validation rules.</summary>
    /// <exception cref="VenueReadException">The message is malformed or fails validation.</exception>
    /// <exception cref="JsonException">The message is not JSON.</exception>
    internal static HyperliquidStreamMessage ParseStreamMessage(ReadOnlyMemory<byte> payload)
    {
        using var document = JsonDocument.Parse(payload, new JsonDocumentOptions { MaxDepth = 16 });
        var root = document.RootElement;
        RejectDuplicateProperties(root);
        var channel = Text(Property(root, "channel"));
        switch (channel)
        {
            case "subscriptionResponse":
            {
                var data = Property(root, "data");
                var subscription = Property(data, "subscription");
                var type = Text(Property(subscription, "type"));
                if (Text(Property(data, "method")) != "subscribe")
                    return new HyperliquidStreamControl(channel);
                var coin = Text(Property(subscription, "coin"));
                return type == "candle"
                    ? new HyperliquidStreamAck(type, coin, Text(Property(subscription, "interval")))
                    : new HyperliquidStreamAck(type, coin, null);
            }
            case "candle":
            {
                var data = Property(root, "data");
                var items = data.ValueKind == JsonValueKind.Array ? data.EnumerateArray().ToList() : [data];
                if (items.Count > MaxStreamCandles)
                    throw new VenueReadException(InvalidResponse);
                return new HyperliquidStreamCandles(items
                    .Select(item => (Text(Property(item, "s")), Text(Property(item, "i")), ReadCandle(item, numbers: true)))
                    .ToList());
            }
            case "activeAssetCtx":
            {
                var data = Property(root, "data");
                var coin = Text(Property(data, "coin"));
                return new HyperliquidStreamContext(ReadMarketContext(coin, Property(data, "ctx"), numbers: true));
            }
            default:
                return new HyperliquidStreamControl(channel);
        }
    }
}
