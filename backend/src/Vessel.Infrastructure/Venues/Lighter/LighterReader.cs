using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vessel.Application.Credentials;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Infrastructure.Venues.Common;

[assembly: InternalsVisibleTo("Vessel.Tests")]

namespace Vessel.Infrastructure.Venues.Lighter;

/// <summary>
/// Read-only REST adapter. Register a scoped reader with a logger-free HttpClient whose base address is
/// https://mainnet.zklighter.elliot.ai/. Disable automatic redirects so Authorization cannot leave this host.
/// There is no credential on the HttpClient, catalogue, or string-source overload.
/// </summary>
public sealed partial class LighterReader(HttpClient httpClient, TimeProvider timeProvider, IAccountCredentialReader credentials)
    : IPerpetualVenueReader, IVenueOrderReader, ICandleReader, IVenueAccountDiscovery, IVenueCredentialVerifier
{
    public const string Id = "lighter";
    private const string InvalidResponse = "Lighter returned an invalid or unsupported response.";
    private const string QuoteAsset = "USDC";
    private const int PageSize = 100, MaxPages = 5, MaxMarkets = 2048, MaxCandles = 500;
    private static readonly StrictJson Json = new(InvalidResponse);
    // Bound parallel manual imports across scoped readers. No automatic retries or background polling here.
    private static readonly SemaphoreSlim ReadSlots = new(2, 2);
    private static readonly IReadOnlyDictionary<string, long> Intervals = new Dictionary<string, long>(StringComparer.Ordinal)
    {
        ["1m"] = 60_000, ["5m"] = 300_000, ["15m"] = 900_000, ["30m"] = 1_800_000,
        ["1h"] = 3_600_000, ["4h"] = 14_400_000, ["12h"] = 43_200_000, ["1d"] = 86_400_000
    };

    public static readonly VenueDescriptor Descriptor = new(Id, "Lighter", "read-only", VenueSources.AccountIndex,
        new VenueCapabilities(Sync: true, Instruments: true, Orders: true, Candles: true,
            MarketContext: false, Stream: false, StablecoinWallet: false, AccountDiscovery: true, ReadOnlyCredential: true),
        QuoteAsset: QuoteAsset, Intervals: [.. Intervals.Keys], PriceRule: PriceRules.TickSize,
        CandleNotice: "Lighter trade candles, at most 500 per manual refresh. Earlier candles and trade counts are unavailable. Prices are observations, never fills.",
        CredentialSetupUrl: "https://app.lighter.xyz/read-only-tokens");

    public string VenueId => Id;
    private BoundedJsonHttp Http => new(httpClient, timeProvider, Json,
        "Lighter is unavailable or refused the read. Try again or verify the read-only token.", "Lighter read timed out.");

    private async Task<T> BoundedAsync<T>(Func<CancellationToken, Task<T>> read, CancellationToken ct)
    {
        try
        {
            return await Http.ReadBoundedAsync(async bounded =>
            {
                await ReadSlots.WaitAsync(bounded);
                try { return await read(bounded); }
                finally { ReadSlots.Release(); }
            }, ct);
        }
        catch (LighterAuthenticationException) { throw new VenueReadException("Lighter did not accept this read-only token."); }
        catch (FormatException) { throw Json.Invalid(); }
        catch (OverflowException) { throw Json.Invalid(); }
        catch (ArgumentOutOfRangeException) { throw Json.Invalid(); }
    }

    private async Task<JsonDocument> GetAsync(string query, CancellationToken ct, string? token = null)
    {
        if (token is not null && (query.Contains(token, StringComparison.Ordinal) ||
            query.Contains(Uri.EscapeDataString(token), StringComparison.Ordinal))) throw Json.Invalid();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/" + query);
        // ro:... is the complete Authorization value, not a scheme/parameter pair.
        // Every caller has already validated it against TokenPattern, including absence of whitespace/CRLF.
        if (token is not null && !request.Headers.TryAddWithoutValidation("Authorization", token)) throw Json.Invalid();
        var document = await Http.SendAsync(request, ct);
        try
        {
            var code = Json.Integer(Json.Property(document.RootElement, "code"));
            if (LighterAuthenticationHandler.IsAuthenticationError(document.RootElement)) throw new LighterAuthenticationException();
            if (code != 200)
                throw new VenueReadException(token is null
                    ? "Lighter refused the public read."
                    : "Lighter did not accept this read-only token.");
            return document;
        }
        catch { document.Dispose(); throw; }
    }

    private static JsonElement Rows(JsonElement root, string name, int limit)
    {
        var rows = Json.Array(Json.Property(root, name));
        if (rows.GetArrayLength() > limit) throw Json.Invalid();
        return rows;
    }

    /// <summary>Never pass an account, order, or trade ID through floating point.</summary>
    internal static string Index(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 19 || !value.All(char.IsAsciiDigit) ||
            !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var index))
            throw new VenueReadException("A nonnegative Lighter account index within int64 is required.");
        return index.ToString(CultureInfo.InvariantCulture);
    }

    private static string Identity(JsonElement value)
    {
        var text = value.ValueKind == JsonValueKind.Number ? value.GetRawText() : Json.Text(value, 19);
        try { return Index(text); }
        catch (VenueReadException) { throw Json.Invalid(); }
    }

    private static string ExactId(JsonElement row, string number, string text)
    {
        var id = Identity(Json.Property(row, number));
        if (row.TryGetProperty(text, out var exact) && Identity(exact) != id) throw Json.Invalid();
        return id;
    }

    private static decimal Number(JsonElement row, string name) => Json.Number(Json.Property(row, name));
    private static decimal Nonnegative(JsonElement row, string name) => Json.Nonnegative(Json.Property(row, name));
    private static string Text(JsonElement row, string name, int max = 128) => Json.Text(Json.Property(row, name), max);

    private static string? Cursor(JsonElement root)
    {
        if (!root.TryGetProperty("next_cursor", out var value)) return null;
        var cursor = Json.TextOrEmpty(value, 1024);
        return cursor.Length == 0 ? null : cursor;
    }

    private static string Source(Account account)
    {
        if (account.VenueId != Id || !account.IsEnabled || account.SourceId is null)
            throw new VenueReadException("An enabled Lighter account is required.");
        return Index(account.SourceId);
    }

    [GeneratedRegex("^[A-Za-z0-9]{1,24}$", RegexOptions.CultureInvariant)]
    private static partial Regex SymbolPattern();

    internal sealed record Market(string MarketId, string Key, bool Active, VenueInstrument? Instrument);
    internal sealed record Catalogue(IReadOnlyList<Market> Markets, IReadOnlySet<string> SpotIds)
    {
        public Market? ById(string id) => Markets.FirstOrDefault(m => m.MarketId == id);
        public Market? ActiveByKey(string key) => Markets.FirstOrDefault(m => m.Active && m.Key == key);
    }

    private async Task<Catalogue> CatalogueAsync(CancellationToken ct)
    {
        using var document = await GetAsync("orderBookDetails", ct);
        return ReadCatalogue(document.RootElement);
    }

    // Official schemas: https://apidocs.lighter.xyz/reference/orderbookdetails.md
    // and https://apidocs.lighter.xyz/reference/orderbooks.md, checked with public mainnet on 2026-10-07.
    internal static Catalogue ReadCatalogue(JsonElement root)
    {
        var markets = new List<Market>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var spotIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in Rows(root, "order_book_details", MaxMarkets).EnumerateArray())
        {
            var id = Identity(Json.Property(row, "market_id"));
            if (!ids.Add(id)) throw Json.Invalid();
            var kind = Text(row, "market_type");
            if (kind == "spot") { spotIds.Add(id); continue; }
            if (kind != "perp") throw Json.Invalid();
            var key = Text(row, "symbol", 24);
            // Lighter already names multiplied assets canonically, e.g. 1000PEPE. No price/size rescaling.
            if (!SymbolPattern().IsMatch(key) || !keys.Add(key)) throw Json.Invalid();
            var sizeDecimals = Json.Integer(Json.Property(row, "supported_size_decimals"));
            var priceDecimals = Json.Integer(Json.Property(row, "supported_price_decimals"));
            var initial = Json.Integer(Json.Property(row, "min_initial_margin_fraction"));
            var maintenance = Json.Integer(Json.Property(row, "maintenance_margin_fraction"));
            var status = Text(row, "status");
            if (status is not ("active" or "inactive")) throw Json.Invalid();
            // Live retired MKR has zero margin fractions. Keep its identity for historical facts,
            // but do not invent leverage or offer it as a selectable instrument.
            if (status == "inactive" && initial == 0 && maintenance == 0)
            {
                markets.Add(new(id, key, false, null));
                continue;
            }
            if (sizeDecimals is < 0 or > 18 || priceDecimals is < 0 or > 18 ||
                initial is < 1 or > 10000 || maintenance < 0 || maintenance > initial) throw Json.Invalid();
            var step = 1m;
            for (var i = 0; i < priceDecimals; i++) step /= 10m;
            var frozen = row.TryGetProperty("is_frozen", out var flag) && Json.Boolean(flag);
            markets.Add(new(id, key, status == "active" && !frozen,
                new VenueInstrument(key, sizeDecimals, 10000 / initial, QuoteAsset, step,
                    VenueContractId: id, MaintenanceMarginFraction: maintenance / 10000m)));
        }
        // Spot markets are returned in a separate array by current mainnet.
        if (root.TryGetProperty("spot_order_book_details", out var spots))
            foreach (var row in Json.Array(spots).EnumerateArray())
            {
                if (Text(row, "market_type") != "spot") throw Json.Invalid();
                var id = Identity(Json.Property(row, "market_id"));
                if (!ids.Add(id)) throw Json.Invalid();
                spotIds.Add(id);
            }
        return new(markets, spotIds);
    }

    public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken cancellationToken) =>
        BoundedAsync<IReadOnlyList<VenueInstrument>>(async ct =>
            (await CatalogueAsync(ct)).Markets.Where(m => m.Active).Select(m => m.Instrument!).ToArray(), cancellationToken);
}
