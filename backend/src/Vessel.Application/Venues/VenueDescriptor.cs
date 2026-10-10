namespace Vessel.Application.Venues;

/// <summary>How an account at a venue is identified. Adapters validate and normalize it.</summary>
public static class VenueSources
{
    public const string None = "none";
    public const string EvmAddress = "evm-address";
    public const string AccountIndex = "account-index";
}

/// <summary>How a venue rounds prices: Hyperliquid's five significant figures, or each instrument's tick.</summary>
public static class PriceRules
{
    public const string SignificantFigures = "significant-figures";
    public const string TickSize = "tick-size";
}

/// <summary>What Vessel can do at a venue. Use cases and the browser check these instead of venue names.</summary>
public sealed record VenueCapabilities(bool Sync, bool Instruments, bool Orders, bool Candles, bool MarketContext, bool Stream, bool StablecoinWallet,
    bool AccountDiscovery = false, bool ReadOnlyCredential = false)
{
    public static readonly VenueCapabilities None = new(false, false, false, false, false, false, false);
}

/// <summary>
/// One venue as Vessel sees it. <paramref name="TradeUrlTemplate"/> uses <c>{instrument}</c> for a canonical key
/// or <c>{venueContractId}</c> for the venue's own identifier.
/// <paramref name="Intervals"/> are the candle intervals the venue serves natively; others are refused, not approximated.
/// The notices replace the generic candle and market-context notices for this venue.
/// Adapters are looked up by <paramref name="Id"/> through <see cref="IVenueRegistry"/>.
/// </summary>
public sealed record VenueDescriptor(
    string Id, string Name, string Status, string Source, VenueCapabilities Capabilities,
    string? QuoteAsset = null, string? TradeUrlTemplate = null, IReadOnlyList<string>? Intervals = null,
    string PriceRule = PriceRules.SignificantFigures, string? CandleNotice = null, string? MarketContextNotice = null,
    string? CredentialSetupUrl = null)
{
    public IReadOnlyList<string> CandleIntervals => Intervals ?? [];

    public const string ManualId = "manual";

    /// <summary>Manual accounts hold owner-entered values: no venue adapter, no source identity.</summary>
    public static readonly VenueDescriptor Manual = new(ManualId, "Manual", "manual", VenueSources.None, VenueCapabilities.None);
}
