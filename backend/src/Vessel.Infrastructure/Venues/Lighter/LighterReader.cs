using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Vessel.Application.Credentials;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Infrastructure.Venues.Common;

namespace Vessel.Infrastructure.Venues.Lighter;

/// <summary>
/// Read-only REST adapter for one <see cref="LighterExchange"/> (mainnet by default). Register a scoped reader per
/// exchange with a logger-free named HttpClient whose base address is that exchange's configured host. Disable
/// automatic redirects so Authorization cannot leave this host.
/// There is no credential on the HttpClient, catalogue, or string-source overload.
/// </summary>
public sealed partial class LighterReader
    : IPerpetualVenueReader, IVenueOrderReader, ICandleReader, IVenueAccountDiscovery, IVenueCredentialVerifier
{
    private const int PageSize = 100, MaxPages = 5, MaxMarkets = 2048, MaxCandles = 500;
    // Bound parallel manual imports across scoped readers, per exchange: each has its own rate limits.
    // No automatic retries or background polling here.
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new(StringComparer.Ordinal);
    private static IReadOnlyDictionary<string, long> Intervals => LighterExchange.Intervals;

    /// <summary>The mainnet descriptor; each exchange has its own (<see cref="LighterExchange.Descriptor"/>).</summary>
    public static VenueDescriptor Descriptor => LighterExchange.Mainnet.Descriptor;

    private readonly HttpClient httpClient;
    private readonly TimeProvider timeProvider;
    private readonly IAccountCredentialReader credentials;
    private readonly LighterExchange venue;
    private readonly StrictJson json;
    private readonly SemaphoreSlim readSlots;
    private readonly LighterCatalogueCache catalogues;

    public LighterReader(HttpClient httpClient, TimeProvider timeProvider, IAccountCredentialReader credentials,
        LighterCatalogueCache? catalogueCache = null, LighterExchange? exchange = null)
    {
        venue = exchange ?? LighterExchange.Mainnet;
        // A shared cache would serve one exchange's market IDs to the other.
        if (catalogueCache is not null && catalogueCache.VenueId != venue.VenueId)
            throw new ArgumentException("The catalogue cache belongs to another Lighter exchange.", nameof(catalogueCache));
        this.httpClient = httpClient;
        this.timeProvider = timeProvider;
        this.credentials = credentials;
        json = venue.Json;
        readSlots = Gates.GetOrAdd(venue.VenueId, _ => new SemaphoreSlim(2, 2));
        catalogues = catalogueCache ?? new(timeProvider, venue.VenueId);
    }

    public string VenueId => venue.VenueId;
    private BoundedJsonHttp Http => new(httpClient, timeProvider, json, venue.Unavailable, venue.TimedOut);

    private async Task<T> BoundedAsync<T>(Func<CancellationToken, Task<T>> read, CancellationToken ct)
    {
        try
        {
            return await Http.ReadBoundedAsync(async bounded =>
            {
                await readSlots.WaitAsync(bounded);
                try { return await read(bounded); }
                finally { readSlots.Release(); }
            }, ct);
        }
        catch (LighterAuthenticationException) { throw new VenueReadException(venue.TokenRefused); }
        catch (FormatException) { throw json.Invalid(); }
        catch (OverflowException) { throw json.Invalid(); }
        catch (ArgumentOutOfRangeException) { throw json.Invalid(); }
    }

    private async Task<JsonDocument> GetAsync(string query, CancellationToken ct, string? token = null)
    {
        if (token is not null && (query.Contains(token, StringComparison.Ordinal) ||
            query.Contains(Uri.EscapeDataString(token), StringComparison.Ordinal))) throw json.Invalid();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/" + query);
        // ro:... is the complete Authorization value, not a scheme/parameter pair.
        // Every caller has already validated it against TokenPattern, including absence of whitespace/CRLF.
        if (token is not null && !request.Headers.TryAddWithoutValidation("Authorization", token)) throw json.Invalid();
        var document = await Http.SendAsync(request, ct);
        try
        {
            var code = json.Integer(json.Property(document.RootElement, "code"));
            if (LighterAuthenticationHandler.IsAuthenticationError(document.RootElement)) throw new LighterAuthenticationException();
            if (code != 200)
                throw new VenueReadException(token is null ? venue.PublicRefused : venue.TokenRefused);
            return document;
        }
        catch { document.Dispose(); throw; }
    }

    private static JsonElement Rows(StrictJson json, JsonElement root, string name, int limit)
    {
        var rows = json.Array(json.Property(root, name));
        if (rows.GetArrayLength() > limit) throw json.Invalid();
        return rows;
    }

    /// <summary>Never pass an account, order, or trade ID through floating point.</summary>
    internal static string Index(string value, LighterExchange? exchange = null)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 19 || !value.All(char.IsAsciiDigit) ||
            !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var index))
            throw new VenueReadException((exchange ?? LighterExchange.Mainnet).IndexRequired);
        return index.ToString(CultureInfo.InvariantCulture);
    }

    private static string Identity(StrictJson json, JsonElement value)
    {
        var text = value.ValueKind == JsonValueKind.Number ? value.GetRawText() : json.Text(value, 19);
        try { return Index(text); }
        catch (VenueReadException) { throw json.Invalid(); }
    }

    private static string ExactId(StrictJson json, JsonElement row, string number, string text)
    {
        var id = Identity(json, json.Property(row, number));
        if (row.TryGetProperty(text, out var exact) && Identity(json, exact) != id) throw json.Invalid();
        return id;
    }

    private static decimal Number(StrictJson json, JsonElement row, string name) => json.Number(json.Property(row, name));
    private static decimal Nonnegative(StrictJson json, JsonElement row, string name) => json.Nonnegative(json.Property(row, name));
    private static string Text(StrictJson json, JsonElement row, string name, int max = 128) => json.Text(json.Property(row, name), max);

    private static string? Cursor(StrictJson json, JsonElement root)
    {
        if (!root.TryGetProperty("next_cursor", out var value)) return null;
        var cursor = json.TextOrEmpty(value, 1024);
        return cursor.Length == 0 ? null : cursor;
    }

    private string Source(Account account)
    {
        if (account.VenueId != venue.VenueId || !account.IsEnabled || account.SourceId is null)
            throw new VenueReadException(venue.AccountRequired);
        return Index(account.SourceId, venue);
    }

    [GeneratedRegex("^[A-Za-z0-9]{1,24}$", RegexOptions.CultureInvariant)]
    private static partial Regex SymbolPattern();

    internal sealed record Market(string MarketId, string Key, bool Active, VenueInstrument? Instrument);
    /// <summary>One exchange's markets. <paramref name="Exchange"/> gives static parsers its collateral and messages.</summary>
    internal sealed record Catalogue(IReadOnlyList<Market> Markets, IReadOnlySet<string> SpotIds, LighterExchange Exchange)
    {
        public Market? ById(string id) => Markets.FirstOrDefault(m => m.MarketId == id);
        public Market? ActiveByKey(string key) => Markets.FirstOrDefault(m => m.Active && m.Key == key);
    }

    // Imports pass refresh so a market listed within the cache lifetime is not filtered out of their facts.
    private Task<Catalogue> CatalogueAsync(CancellationToken ct, bool refresh = false) => catalogues.GetAsync(token =>
        // Public single-flight metadata must not reacquire the account-read semaphore.
        Http.ReadBoundedAsync(async bounded =>
        {
            using var document = await GetAsync("orderBookDetails", bounded);
            return ReadCatalogue(document.RootElement, venue);
        }, token), ct, refresh);

    // Official schemas: https://apidocs.lighter.xyz/reference/orderbookdetails.md
    // and https://apidocs.lighter.xyz/reference/orderbooks.md, checked with public mainnet on 2026-10-07.
    internal static Catalogue ReadCatalogue(JsonElement root, LighterExchange? exchange = null)
    {
        exchange ??= LighterExchange.Mainnet;
        var json = exchange.Json;
        var markets = new List<Market>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var spotIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in Rows(json, root, "order_book_details", MaxMarkets).EnumerateArray())
        {
            var id = Identity(json, json.Property(row, "market_id"));
            if (!ids.Add(id)) throw json.Invalid();
            var kind = Text(json, row, "market_type");
            if (kind == "spot") { spotIds.Add(id); continue; }
            if (kind != "perp") throw json.Invalid();
            var key = Text(json, row, "symbol", 24);
            // Lighter already names multiplied assets canonically, e.g. 1000PEPE. No price/size rescaling.
            if (!SymbolPattern().IsMatch(key)) throw json.Invalid();
            var sizeDecimals = json.Integer(json.Property(row, "supported_size_decimals"));
            var priceDecimals = json.Integer(json.Property(row, "supported_price_decimals"));
            var initial = json.Integer(json.Property(row, "min_initial_margin_fraction"));
            var maintenance = json.Integer(json.Property(row, "maintenance_margin_fraction"));
            var status = Text(json, row, "status");
            if (status is not ("active" or "inactive")) throw json.Invalid();
            // Live retired MKR has zero margin fractions. Keep its identity for historical facts,
            // but do not invent leverage or offer it as a selectable instrument.
            if (status == "inactive" && initial == 0 && maintenance == 0)
            {
                markets.Add(new(id, key, false, null));
                continue;
            }
            if (sizeDecimals is < 0 or > 18 || priceDecimals is < 0 or > 18 ||
                initial is < 1 or > 10000 || maintenance < 0 || maintenance > initial) throw json.Invalid();
            var step = 1m;
            for (var i = 0; i < priceDecimals; i++) step /= 10m;
            var frozen = row.TryGetProperty("is_frozen", out var flag) && json.Boolean(flag);
            if (status == "active" && !frozen && !keys.Add(key)) throw json.Invalid();
            markets.Add(new(id, key, status == "active" && !frozen,
                new VenueInstrument(key, sizeDecimals, 10000 / initial, exchange.Collateral, step,
                    VenueContractId: id, MaintenanceMarginFraction: maintenance / 10000m)));
        }
        // Spot markets are returned in a separate array by current mainnet.
        if (root.TryGetProperty("spot_order_book_details", out var spots))
            foreach (var row in json.Array(spots).EnumerateArray())
            {
                if (Text(json, row, "market_type") != "spot") throw json.Invalid();
                var id = Identity(json, json.Property(row, "market_id"));
                if (!ids.Add(id)) throw json.Invalid();
                spotIds.Add(id);
            }
        return new(markets, spotIds, exchange);
    }

    public async Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken cancellationToken) =>
        (await CatalogueAsync(cancellationToken)).Markets.Where(m => m.Active).Select(m => m.Instrument!).ToArray();
}

/// <summary>
/// Public full metadata only; inactive and frozen IDs remain available for historical facts. One cache per exchange:
/// market IDs are meaningless on the other exchange.
/// </summary>
public sealed class LighterCatalogueCache(TimeProvider time, string venueId = "lighter")
{
    private readonly BoundedMarketDataCache<LighterReader.Catalogue> entries = new(time, 1, 1, _ => 1);
    public string VenueId { get; } = venueId;
    internal Task<LighterReader.Catalogue> GetAsync(Func<CancellationToken, Task<LighterReader.Catalogue>> load,
        CancellationToken ct, bool refresh = false) => entries.GetAsync(VenueId + ":order-books", load, _ => TimeSpan.FromSeconds(60), ct, refresh);
}
