namespace Vessel.Infrastructure.Venues.Hyperliquid;

internal static class HyperliquidInstruments
{
    // Primary /info meta checked October 7, 2026, including delisted kDOGS.
    // These contracts quote 1,000 base units. A lowercase k alone is not a multiplier rule.
    // Keep this list aligned with the HyperliquidCanonicalInstruments data migration.
    internal static readonly IReadOnlyDictionary<string, string> CanonicalKeys =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["kPEPE"] = "1000PEPE",
            ["kSHIB"] = "1000SHIB",
            ["kBONK"] = "1000BONK",
            ["kLUNC"] = "1000LUNC",
            ["kFLOKI"] = "1000FLOKI",
            ["kDOGS"] = "1000DOGS",
            ["kNEIRO"] = "1000NEIRO"
        };

    private static readonly IReadOnlyDictionary<string, string> VenueKeys =
        CanonicalKeys.ToDictionary(pair => pair.Value, pair => pair.Key, StringComparer.Ordinal);

    internal static string Canonical(string venueContractId) =>
        CanonicalKeys.GetValueOrDefault(venueContractId, venueContractId);

    internal static string Native(string contractId) => VenueKeys.GetValueOrDefault(contractId, contractId);
}
