namespace Vessel.Application.System;

public sealed record JournalOwner(Guid Id, string DisplayName);
public sealed record VenueMetadata(string Id, string Name, string Status);
public sealed record SystemMetadata(
    string Application, string Stage, JournalOwner Owner, string MarketScope,
    bool AllowsConcurrentPlays, IReadOnlyList<VenueMetadata> Venues)
{
    public static SystemMetadata ForOwner(JournalOwner owner) => new(
        "Vessel", "core", owner, "perpetuals", true,
        [new("hyperliquid", "Hyperliquid", "read-only"),
         new("lighter", "Lighter", "planned"),
         new("quantfury", "Quantfury", "candidate"),
         new("manual", "Manual", "manual")]);
}
