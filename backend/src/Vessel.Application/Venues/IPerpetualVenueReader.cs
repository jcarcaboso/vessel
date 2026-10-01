namespace Vessel.Application.Venues;

// External adapters supply read-only, normalized perpetual facts. These types
// carry no journal thesis, play assignment, persistence or venue SDK dependency.
public interface IPerpetualVenueReader
{
    string VenueId { get; }
    Task<PerpetualVenueReadResult> ReadAsync(string publicAddress, CancellationToken cancellationToken);
}

public sealed record VenueInstrument(string ContractId, int QuantityDecimals, int MaxLeverage);

public sealed record VenuePosition(
    string ContractId,
    decimal SignedQuantity,
    decimal EntryPrice,
    decimal UnrealizedPnlUsd,
    decimal MarginUsedUsd,
    int? Leverage);

public sealed record VenueSnapshot(
    DateTimeOffset ObservedAtUtc,
    string ValueScope,
    decimal AccountValueUsd,
    decimal WithdrawableUsd,
    decimal MarginUsedUsd,
    IReadOnlyList<VenuePosition> Positions);

public sealed record VenueFill(
    string SourceFillId,
    string ContractId,
    string Side,
    string Direction,
    decimal Price,
    decimal Quantity,
    decimal Fee,
    string FeeToken,
    decimal ClosedPnlUsd,
    DateTimeOffset OccurredAtUtc,
    string OrderId,
    string TransactionHash,
    string RawJson);

public sealed record PerpetualVenueReadResult(
    VenueSnapshot Snapshot,
    IReadOnlyList<VenueInstrument> Instruments,
    IReadOnlyList<VenueFill> Fills,
    string HistoryNotice);

public sealed class VenueReadException(string message) : Exception(message);
