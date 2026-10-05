using Vessel.Application.System;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Infrastructure.Venues.Hyperliquid;
using Vessel.Application.Plays.Execution;

namespace Vessel.Tests;

public sealed class VenueRegistryTests
{
    /// <summary>A second venue: its own name, source rule, capabilities and reader, never mentioned by a use case.</summary>
    private sealed class OtherReader : IPerpetualVenueReader
    {
        public string VenueId => "other";
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<VenueInstrument>>([new("ABC", 3, 10, "USDC")]);
        public Task<PerpetualVenueReadResult> ReadAsync(string address, CancellationToken ct) => throw new NotSupportedException();
    }

    private static readonly VenueDescriptor Other = new("other", "Other", "read-only", VenueSources.EvmAddress,
        new VenueCapabilities(Sync: true, Instruments: true, Orders: false, Candles: false, MarketContext: false, Stream: false, StablecoinWallet: false), "USDC");

    private static VenueRegistry Registry(params object[] adapters) => new(
        [VenueDescriptor.Manual, HyperliquidPerpetualReader.Descriptor, Other],
        adapters.OfType<IPerpetualVenueReader>(), [], [], [], []);

    [Fact]
    public void Adapters_are_found_by_venue_id_and_the_last_registration_wins()
    {
        var first = new FixtureReader(); var second = new FixtureReader(); var other = new OtherReader();
        var registry = Registry(first, other, second);
        Assert.Same(second, registry.Reader("hyperliquid"));
        Assert.Same(other, registry.Reader("other"));
        Assert.Null(registry.Reader("lighter"));
        Assert.Null(registry.Candles("hyperliquid"));
        Assert.Equal("Other", registry.Descriptor("other")!.Name);
        Assert.Null(registry.Descriptor("lighter"));
        Assert.Equal(["manual", "hyperliquid", "other"], registry.Descriptors.Select(d => d.Id));
    }

    [Fact]
    public async Task A_second_venue_works_through_create_instruments_and_sync_rules_without_use_case_changes()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var service = new WorkspaceService(store, new CoreOwner(owner), Registry(new FixtureReader(), new OtherReader()));
        const string address = "0x0123456789abcdef0123456789abcdef01234567";

        var bad = await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "Bad", "other", "0x12"), default));
        Assert.Equal((400, "Other requires a 42-character public hexadecimal address."), (bad.StatusCode, bad.Message));
        var unknown = await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "Nope", "lighter", address), default));
        Assert.Equal((400, "Choose manual, hyperliquid or other."), (unknown.StatusCode, unknown.Message));

        var account = await service.CreateAccountAsync(new(null, "Second", "other", address), default);
        Assert.Equal("other", account.VenueId);
        var catalogue = await service.InstrumentsAsync(account.Id, default);
        Assert.Equal("other", catalogue.VenueId);
        Assert.Equal("ABC", Assert.Single(catalogue.Instruments).ContractId);
        var duplicate = await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "Again", "other", address.ToUpperInvariant().Replace("0X", "0x")), default));
        Assert.Equal(409, duplicate.StatusCode);
    }

    [Fact]
    public async Task Sync_needs_the_sync_capability_and_an_adapter()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        const string address = "0x0123456789abcdef0123456789abcdef01234567";
        var noSync = Other with { Capabilities = Other.Capabilities with { Sync = false } };
        var registry = new VenueRegistry([VenueDescriptor.Manual, HyperliquidPerpetualReader.Descriptor, noSync], [new FixtureReader()], [], [], [], []);
        var service = new WorkspaceService(store, new CoreOwner(owner), registry);
        var manual = await service.CreateAccountAsync(new(null, "Manual", "manual"), default);
        var refused = await Assert.ThrowsAsync<WorkspaceException>(() => service.SyncAsync(manual.Id, default));
        Assert.Equal((400, "Only Hyperliquid accounts can be refreshed."), (refused.StatusCode, refused.Message));

        // Sync is allowed for the venue but its adapter is not registered.
        var missing = new WorkspaceService(store, new CoreOwner(owner), Registry());
        var account = await missing.CreateAccountAsync(new(null, "Second", "other", address), default);
        var unavailable = await Assert.ThrowsAsync<WorkspaceException>(() => missing.SyncAsync(account.Id, default));
        Assert.Equal((503, "Venue reader is unavailable."), (unavailable.StatusCode, unavailable.Message));
    }

    [Fact]
    public void Order_tracking_follows_the_venue_capability()
    {
        var account = new Account(Guid.NewGuid(), Guid.NewGuid(), "other", "A");
        account.Configure(null, "0x0123456789abcdef0123456789abcdef01234567", null);
        var play = Plan(account);
        Assert.Equal("Orders are only tracked at venues that provide them.", PlayExecutionService.UntrackedReason(play, account, Other));
        var tracked = Other with { Capabilities = Other.Capabilities with { Orders = true } };
        Assert.Null(PlayExecutionService.UntrackedReason(play, account, tracked));
        Assert.NotNull(PlayExecutionService.UntrackedReason(play, account, null));
    }

    [Fact]
    public void System_metadata_lists_registered_venues_then_planned_ones_with_manual_last()
    {
        var metadata = SystemMetadata.ForOwner(new JournalOwner(Guid.NewGuid(), "Owner"), Registry());
        Assert.Equal(["hyperliquid", "other", "lighter", "quantfury", "manual"], metadata.Venues.Select(v => v.Id));
        Assert.True(metadata.Venues.Single(v => v.Id == "other").Capabilities.Sync);
        Assert.Equal(VenueCapabilities.None, metadata.Venues.Single(v => v.Id == "lighter").Capabilities);

        // A venue that gains an adapter replaces its planned entry instead of duplicating it.
        var lighter = new VenueDescriptor("lighter", "Lighter", "read-only", VenueSources.None, VenueCapabilities.None);
        var registered = SystemMetadata.ForOwner(new JournalOwner(Guid.NewGuid(), "Owner"),
            new VenueRegistry([VenueDescriptor.Manual, lighter], [], [], [], [], []));
        Assert.Single(registered.Venues, v => v.Id == "lighter");
        Assert.Equal("read-only", registered.Venues.Single(v => v.Id == "lighter").Status);
    }

    private static Play Plan(Account account)
    {
        var play = TestPlays.Create(account, new PerpetualInstrument(account.VenueId, "ABC"));
        play.MarkPlanned(DateTimeOffset.UnixEpoch);
        return play;
    }
}
