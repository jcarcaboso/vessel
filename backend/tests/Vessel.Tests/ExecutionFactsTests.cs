using Vessel.Application.Venues;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Tests;

public sealed class ExecutionFactsTests
{
    [Theory]
    [InlineData("B", "buy")]
    [InlineData("A", "sell")]
    public void Hyperliquid_sides_become_buy_and_sell(string venue, string vessel) =>
        Assert.Equal(vessel, HyperliquidPerpetualReader.SideOf(venue));

    [Theory]
    [InlineData("Open Long", "open")]
    [InlineData("Open Short", "open")]
    [InlineData("Close Long", "close")]
    [InlineData("Close Short", "close")]
    [InlineData("Long > Short", "flip")]
    [InlineData("Short > Long", "flip")]
    [InlineData("Liquidated Isolated Long", "unknown")]
    [InlineData("Settlement", "unknown")]
    public void Hyperliquid_directions_map_to_position_effects_without_guessing(string direction, string effect) =>
        Assert.Equal(effect, HyperliquidPerpetualReader.EffectOf(direction));

    [Theory]
    [InlineData("close", true)]
    [InlineData("flip", true)]
    [InlineData("open", false)]
    [InlineData("unknown", false)]
    public void Only_closes_and_flips_reduce_a_position(string effect, bool closes) => Assert.Equal(closes, ExecutionFacts.Closes(effect));

    private static VenueFill Fill(string side = "buy", string effect = "open", string feeBasis = "reported", string pnlBasis = "gross", decimal fee = 0.1m) =>
        new("1", "BTC", side, "Open Long", 100, 1, fee, "USDC", 0, DateTimeOffset.UnixEpoch, "1", "0x1", "{}", effect, feeBasis, pnlBasis);

    [Fact]
    public void Adapter_output_must_use_vessels_vocabulary()
    {
        Assert.True(VenueFactChecks.Valid(Fill()));
        Assert.True(VenueFactChecks.Valid(Fill(side: "sell", effect: "flip", pnlBasis: "net-of-fee")));
        Assert.True(VenueFactChecks.Valid(Fill(feeBasis: "standard-account-free", fee: 0)));
        Assert.False(VenueFactChecks.Valid(Fill(side: "B")));
        Assert.False(VenueFactChecks.Valid(Fill(effect: "Close Long")));
        Assert.False(VenueFactChecks.Valid(Fill(pnlBasis: "net")));
        Assert.False(VenueFactChecks.Valid(Fill(feeBasis: "free")));
        // A fee-free basis cannot hide a reported fee.
        Assert.False(VenueFactChecks.Valid(Fill(feeBasis: "standard-account-free", fee: 0.1m)));
    }

    [Fact]
    public void Orders_must_use_buy_or_sell()
    {
        VenueOrder Order(string side) => new("1", "BTC", side, "Limit", 100, null, false, false, 1, 1, DateTimeOffset.UnixEpoch,
            VenueOrderStatus.Open, "open", DateTimeOffset.UnixEpoch);
        Assert.True(VenueFactChecks.Valid(Order("buy")));
        Assert.False(VenueFactChecks.Valid(Order("A")));
    }
}
