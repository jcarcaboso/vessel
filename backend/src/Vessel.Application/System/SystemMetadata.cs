using Vessel.Application.Venues;

namespace Vessel.Application.System;

public sealed record JournalOwner(Guid Id, string DisplayName);
public sealed record VenueMetadata(
    string Id, string Name, string Status, string Source, VenueCapabilities Capabilities,
    string? QuoteAsset, string? TradeUrlTemplate, IReadOnlyList<string> Intervals, string PriceRule);
public sealed record SystemMetadata(
    string Application, string Stage, JournalOwner Owner, string MarketScope,
    bool AllowsConcurrentPlays, IReadOnlyList<VenueMetadata> Venues)
{
    // Venues the owner has named but that have no adapter yet. They are listed so the browser can say so.
    private static readonly VenueDescriptor[] Upcoming =
    [
        new("lighter", "Lighter", "planned", VenueSources.None, VenueCapabilities.None),
        new("quantfury", "Quantfury", "candidate", VenueSources.None, VenueCapabilities.None),
    ];

    public static SystemMetadata ForOwner(JournalOwner owner, IVenueRegistry venues) => new(
        "Vessel", "core", owner, "perpetuals", true,
        venues.Descriptors.Concat(Upcoming.Where(u => venues.Descriptor(u.Id) is null))
            .OrderBy(d => d.Id == VenueDescriptor.ManualId ? 1 : 0)
            .Select(d => new VenueMetadata(d.Id, d.Name, d.Status, d.Source, d.Capabilities, d.QuoteAsset, d.TradeUrlTemplate,
                d.CandleIntervals, d.PriceRule))
            .ToList());
}
