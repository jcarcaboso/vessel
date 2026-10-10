using Vessel.Domain.Workspace;
using Vessel.Domain.Accounts;

namespace Vessel.Application.Venues;

// External adapters supply read-only, normalized perpetual facts. These types
// carry no journal thesis, play assignment, persistence or venue SDK dependency.
public interface IPerpetualVenueReader
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken cancellationToken);
    Task<PerpetualVenueReadResult> ReadAsync(string publicAddress, CancellationToken cancellationToken);
    Task<PerpetualVenueReadResult> ReadAsync(Account account, CancellationToken cancellationToken) =>
        ReadAsync(account.SourceId ?? throw new VenueReadException("Account source is unavailable."), cancellationToken);
}

/// <summary>
/// A selectable perpetual. <paramref name="ContractId"/> is Vessel's instrument key (the canonical asset, e.g. BTC);
/// <paramref name="VenueContractId"/> is the venue's own identifier when it differs (e.g. a numeric market ID).
/// Prices are quoted and margined in <paramref name="QuoteAsset"/>, e.g. BTC/USDC. <paramref name="PriceStep"/> is the
/// tick when the venue has one; <paramref name="Category"/> labels non-crypto markets (stocks, commodities, indices).
/// <paramref name="MaintenanceMarginFraction"/> is the maintenance margin as a fraction of notional (0.0125 at 40×
/// on Hyperliquid) when the venue states it; liquidation estimates otherwise assume one.
/// </summary>
public sealed record VenueInstrument(string ContractId, int QuantityDecimals, int MaxLeverage, string QuoteAsset,
    decimal? PriceStep = null, string? Category = null, string? VenueContractId = null, decimal? MaintenanceMarginFraction = null);

public sealed record VenuePosition(
    string ContractId,
    decimal SignedQuantity,
    decimal EntryPrice,
    decimal UnrealizedPnlUsd,
    decimal MarginUsedUsd,
    int? Leverage,
    string? VenueContractId = null);

public sealed record VenueSnapshot(
    DateTimeOffset ObservedAtUtc,
    string ValueScope,
    decimal AccountValueUsd,
    decimal? WithdrawableUsd,
    decimal MarginUsedUsd,
    IReadOnlyList<VenuePosition> Positions,
    VenueStablecoinWallet? StablecoinWallet = null);

public sealed record VenueStablecoinBalance(
    string Symbol, int TokenIndex, string TokenId,
    decimal Total, decimal Held, decimal Available);

public sealed record VenueStablecoinWallet(
    DateTimeOffset ObservedAtUtc, string AccountMode, string Scope,
    IReadOnlyList<VenueStablecoinBalance> Balances);

/// <summary>
/// One execution. <paramref name="Side"/> and <paramref name="PositionEffect"/> use <see cref="ExecutionFacts"/>;
/// <paramref name="Direction"/> keeps the venue's wording. <paramref name="PnlBasis"/> says whether
/// <paramref name="ClosedPnlUsd"/> already has the fee taken off.
/// </summary>
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
    string RawJson,
    string PositionEffect = ExecutionFacts.Unknown,
    string FeeBasis = ExecutionFacts.FeeReported,
    string PnlBasis = ExecutionFacts.PnlGross,
    // Set by venues whose own identifier differs from Vessel's instrument key.
    string? VenueContractId = null);

/// <summary>Rejects adapter output that does not use Vessel's execution vocabulary, before anything is stored.</summary>
public static class VenueFactChecks
{
    public static bool Valid(VenueFill fill) => ExecutionFacts.IsSide(fill.Side) && ExecutionFacts.IsEffect(fill.PositionEffect) &&
        ExecutionFacts.IsFeeBasis(fill.FeeBasis) && ExecutionFacts.IsPnlBasis(fill.PnlBasis) &&
        (fill.FeeBasis != ExecutionFacts.FeeStandardAccountFree || fill.Fee == 0);

    public static bool Valid(VenueOrder order) => ExecutionFacts.IsSide(order.Side);
}

public sealed record PerpetualVenueReadResult(
    VenueSnapshot Snapshot,
    IReadOnlyList<VenueInstrument> Instruments,
    IReadOnlyList<VenueFill> Fills,
    string HistoryNotice);

public sealed class VenueReadException(string message) : Exception(message);

/// <summary>The owner's credential input is unusable (format, expiry or wrong wallet); not a venue outage.</summary>
public sealed class VenueCredentialRejectedException() : Exception("The read-only token is not valid for this wallet.");
