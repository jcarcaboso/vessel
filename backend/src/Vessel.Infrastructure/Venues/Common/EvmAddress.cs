using Vessel.Application.Venues;
using Vessel.Domain.Accounts;

namespace Vessel.Infrastructure.Venues.Common;

/// <summary>The public-address check shared by venues that identify accounts by an EVM address.</summary>
public static class EvmAddress
{
    /// <summary>The address unchanged when it is 0x followed by 40 hexadecimal digits.</summary>
    public static string Require(string? publicAddress) =>
        AccountSource.IsEvmAddress(publicAddress)
            ? publicAddress
            : throw new VenueReadException("A valid 42-character hexadecimal public address is required.");
}
