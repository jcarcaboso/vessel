using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Vessel.Application.Venues;

namespace Vessel.Infrastructure.Venues.Hyperliquid;

/// <summary>
/// Bounded, read-only primary perpetual DEX adapter. Composition supplies an
/// HttpClient with BaseAddress https://api.hyperliquid.xyz/ (and no signing credentials).
/// </summary>
public sealed class HyperliquidPerpetualReader(HttpClient httpClient, TimeProvider timeProvider)
    : IPerpetualVenueReader
{
    // Official schemas and bounds, checked October 1, 2026:
    // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
    // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
    // https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py
    // https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/types.py
    private const int MaxResponseBytes = 4 * 1024 * 1024;
    private const int MaxFills = 2000;
    private const string InvalidResponse = "Hyperliquid returned an invalid or unsupported response.";
    private const string HistoryNotice =
        "Incomplete history: only primary perpetual DEX contracts recognized by current metadata are included. " +
        "userFills returns at most the latest 2,000 fills across markets before filtering; older fills, spot, " +
        "other DEXs and unrecognized contracts are excluded. This is not complete lifetime history. " +
        "Account value is primary perpetual margin only, not total spot/unified account equity.";

    public string VenueId => "hyperliquid";

    public async Task<PerpetualVenueReadResult> ReadAsync(string publicAddress, CancellationToken cancellationToken)
    {
        if (publicAddress is null || publicAddress.Length != 42 ||
            !publicAddress.StartsWith("0x", StringComparison.Ordinal) ||
            !publicAddress.Skip(2).All(char.IsAsciiHexDigit))
            throw new VenueReadException("A valid 42-character hexadecimal public address is required.");

        cancellationToken.ThrowIfCancellationRequested();
        // ResponseHeadersRead does not apply HttpClient.Timeout to reading the body.
        // Bound the entire three-request operation, including streamed bodies.
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20), timeProvider);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var latestTimestamp = Math.Min(253402300799999L, timeProvider.GetUtcNow().ToUnixTimeMilliseconds() + 300000);

        try
        {
            using var meta = await ReadJsonAsync(new { type = "meta", dex = "" }, linked.Token);
            var instruments = ReadInstruments(meta.RootElement);
            var contracts = instruments.Select(instrument => instrument.ContractId).ToHashSet(StringComparer.Ordinal);

            using var state = await ReadJsonAsync(
                new { type = "clearinghouseState", user = publicAddress, dex = "" }, linked.Token);
            var snapshot = ReadSnapshot(state.RootElement, contracts, latestTimestamp);

            using var fills = await ReadJsonAsync(
                new { type = "userFills", user = publicAddress, aggregateByTime = false }, linked.Token);
            var executions = ReadFills(fills.RootElement, contracts, latestTimestamp);
            linked.Token.ThrowIfCancellationRequested();
            return new(snapshot, instruments, executions, HistoryNotice);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw new VenueReadException("Hyperliquid read timed out.");
        }
        catch (HttpRequestException)
        {
            throw new VenueReadException("Hyperliquid is unavailable. Try again later.");
        }
        catch (IOException)
        {
            throw new VenueReadException("Hyperliquid is unavailable. Try again later.");
        }
        catch (JsonException)
        {
            throw new VenueReadException(InvalidResponse);
        }
        catch (InvalidOperationException)
        {
            throw new VenueReadException(InvalidResponse);
        }
    }

    private async Task<JsonDocument> ReadJsonAsync(object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/info")
        {
            Content = JsonContent.Create(payload)
        };
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new VenueReadException("Hyperliquid is unavailable. Try again later.");
        if (response.Content.Headers.ContentLength > MaxResponseBytes)
            throw new VenueReadException(InvalidResponse);

        using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var bytes = new MemoryStream();
        var buffer = new byte[16384];
        int count;
        while ((count = await body.ReadAsync(buffer, cancellationToken)) != 0)
        {
            if (bytes.Length + count > MaxResponseBytes)
                throw new VenueReadException(InvalidResponse);
            bytes.Write(buffer, 0, count);
        }
        var document = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
        try
        {
            RejectDuplicateProperties(document.RootElement);
            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    private static List<VenueInstrument> ReadInstruments(JsonElement meta)
    {
        var result = new List<VenueInstrument>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in Array(Property(meta, "universe")).EnumerateArray())
        {
            var name = Text(Property(item, "name"));
            if (!IsPrimaryContract(name))
                continue;
            var decimals = Integer(Property(item, "szDecimals"));
            var leverage = Integer(Property(item, "maxLeverage"));
            if (decimals is < 0 or > 28 || leverage <= 0 || !names.Add(name))
                throw new VenueReadException(InvalidResponse);
            result.Add(new(name, decimals, leverage));
        }
        return result;
    }

    private static VenueSnapshot ReadSnapshot(JsonElement state, HashSet<string> contracts, long latestTimestamp)
    {
        var summary = Property(state, "marginSummary");
        var positions = new List<VenuePosition>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in Array(Property(state, "assetPositions")).EnumerateArray())
        {
            var position = Property(item, "position");
            var name = Text(Property(position, "coin"));
            if (!contracts.Contains(name))
                continue;
            var quantity = Number(Property(position, "szi"));
            if (quantity == 0)
                continue;
            if (Text(Property(item, "type")) != "oneWay" || !names.Add(name))
                throw new VenueReadException(InvalidResponse);

            int? leverage = null;
            if (position.TryGetProperty("leverage", out var leverageElement) && leverageElement.ValueKind != JsonValueKind.Null)
            {
                leverage = Integer(Property(leverageElement, "value"));
                if (leverage <= 0)
                    throw new VenueReadException(InvalidResponse);
            }
            positions.Add(new(name, quantity, Positive(Property(position, "entryPx")),
                Number(Property(position, "unrealizedPnl")), Nonnegative(Property(position, "marginUsed")), leverage));
        }
        return new(
            Timestamp(Property(state, "time"), latestTimestamp),
            "primary-perpetual-dex",
            Number(Property(summary, "accountValue")),
            Nonnegative(Property(state, "withdrawable")),
            Nonnegative(Property(summary, "totalMarginUsed")),
            positions);
    }

    private static List<VenueFill> ReadFills(JsonElement root, HashSet<string> contracts, long latestTimestamp)
    {
        var array = Array(root);
        if (array.GetArrayLength() > MaxFills)
            throw new VenueReadException(InvalidResponse);
        var fills = new List<VenueFill>();
        foreach (var fill in array.EnumerateArray())
        {
            var name = Text(Property(fill, "coin"));
            if (!contracts.Contains(name))
                continue;
            var side = Text(Property(fill, "side"));
            if (side is not ("A" or "B"))
                throw new VenueReadException(InvalidResponse);
            fills.Add(new(
                Identity(Property(fill, "tid")), name, side,
                Text(Property(fill, "dir")), Positive(Property(fill, "px")), Positive(Property(fill, "sz")),
                Number(Property(fill, "fee")), Text(Property(fill, "feeToken")),
                Number(Property(fill, "closedPnl")), Timestamp(Property(fill, "time"), latestTimestamp),
                Identity(Property(fill, "oid")), Text(Property(fill, "hash")), fill.GetRawText()));
        }
        // Preserve venue side/direction as facts; they do not identify a journal play.
        return fills.OrderByDescending(fill => fill.OccurredAtUtc).ToList();
    }

    private static bool IsPrimaryContract(string name) =>
        !name.StartsWith('@') && !name.Contains('/') && !name.Contains(':');

    private static JsonElement Property(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static JsonElement Array(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
            throw new VenueReadException(InvalidResponse);
        return element;
    }

    private static string Text(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
            throw new VenueReadException(InvalidResponse);
        var value = element.GetString()!;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.Any(char.IsControl))
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static int Integer(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static DateTimeOffset Timestamp(JsonElement element, long latestTimestamp)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt64(out var value) ||
            value < 0 || value > latestTimestamp)
            throw new VenueReadException(InvalidResponse);
        return DateTimeOffset.FromUnixTimeMilliseconds(value);
    }

    private static string Identity(JsonElement element)
    {
        var value = element.ValueKind switch
        {
            JsonValueKind.Number => element.GetRawText(),
            JsonValueKind.String => Text(element),
            _ => throw new VenueReadException(InvalidResponse)
        };
        if (value.Length > 128 || !value.All(char.IsAsciiDigit))
            throw new VenueReadException(InvalidResponse);
        // No double/decimal conversion: identities can exceed JavaScript's safe integer range.
        var normalized = value.TrimStart('0');
        return normalized.Length == 0 ? "0" : normalized;
    }

    private static decimal Positive(JsonElement element)
    {
        var value = Number(element);
        if (value <= 0)
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static decimal Nonnegative(JsonElement element)
    {
        var value = Number(element);
        if (value < 0)
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static decimal Number(JsonElement element)
    {
        var text = Text(element);
        var unsigned = text.StartsWith('-') ? text[1..] : text;
        var parts = unsigned.Split('.');
        if (parts.Length > 2 || parts.Any(part => part.Length == 0 || !part.All(char.IsAsciiDigit)))
            throw new VenueReadException(InvalidResponse);
        var fraction = parts.Length == 2 ? parts[1].TrimEnd('0') : "";
        var coefficient = (parts[0] + fraction).TrimStart('0');
        const string maxCoefficient = "79228162514264337593543950335";
        // decimal.TryParse alone rounds excess precision. Reject values that cannot
        // be represented exactly by a 96-bit coefficient and a scale of at most 28.
        if (fraction.Length > 28 || coefficient.Length > maxCoefficient.Length ||
            (coefficient.Length == maxCoefficient.Length &&
             string.CompareOrdinal(coefficient, maxCoefficient) > 0) ||
            !decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var value))
            throw new VenueReadException(InvalidResponse);
        return value;
    }

    private static void RejectDuplicateProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                    throw new VenueReadException(InvalidResponse);
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
                RejectDuplicateProperties(child);
        }
    }
}
