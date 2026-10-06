namespace Vessel.Application.Venues;

/// <summary>How an account at a venue is identified. Adapters validate and normalize it.</summary>
public static class VenueSources
{
    public const string None = "none";
    public const string EvmAddress = "evm-address";
}

/// <summary>What Vessel can do at a venue. Use cases and the browser check these instead of venue names.</summary>
public sealed record VenueCapabilities(bool Sync, bool Instruments, bool Orders, bool Candles, bool MarketContext, bool Stream, bool StablecoinWallet)
{
    public static readonly VenueCapabilities None = new(false, false, false, false, false, false, false);
}

/// <summary>
/// One venue as Vessel sees it. <paramref name="TradeUrlTemplate"/> uses an <c>{instrument}</c> placeholder.
/// Adapters are looked up by <paramref name="Id"/> through <see cref="IVenueRegistry"/>.
/// </summary>
public sealed record VenueDescriptor(
    string Id, string Name, string Status, string Source, VenueCapabilities Capabilities,
    string? QuoteAsset = null, string? TradeUrlTemplate = null)
{
    public const string ManualId = "manual";

    /// <summary>Manual accounts hold owner-entered values: no venue adapter, no source identity.</summary>
    public static readonly VenueDescriptor Manual = new(ManualId, "Manual", "manual", VenueSources.None, VenueCapabilities.None);
}
