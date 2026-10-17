using Vessel.Domain.Accounts;

namespace Vessel.Application.Venues;

/// <summary>Reads an account's orders: current open orders and recent order history, read-only.</summary>
public interface IVenueOrderReader
{
    string VenueId { get; }
    Task<VenueOrderReadResult> ReadOrdersAsync(string sourceId, CancellationToken cancellationToken);
    Task<VenueOrderReadResult> ReadOrdersAsync(Account account, CancellationToken cancellationToken) =>
        ReadOrdersAsync(account.SourceId ?? throw new VenueReadException("Account source is unavailable."), cancellationToken);
}

/// <summary>Normalized order lifecycle; <see cref="VenueOrder.VenueStatus"/> keeps the venue's own word.</summary>
public enum VenueOrderStatus { Open, Filled, Triggered, Canceled, Rejected, Other }

/// <summary>
/// One order at the venue. <see cref="Side"/> is <c>buy</c> or <c>sell</c>. Prices and sizes are exact. A trigger order (stop or take profit) acts at
/// <see cref="TriggerPrice"/>; a plain limit order rests at <see cref="LimitPrice"/>.
/// </summary>
public sealed record VenueOrder(
    string OrderId,
    string ContractId,
    string Side,
    string OrderType,
    decimal LimitPrice,
    decimal? TriggerPrice,
    bool ReduceOnly,
    bool IsPositionTpsl,
    decimal OriginalSize,
    decimal RemainingSize,
    DateTimeOffset PlacedAtUtc,
    VenueOrderStatus Status,
    string VenueStatus,
    DateTimeOffset StatusAtUtc,
    string? VenueContractId = null)
{
    /// <summary>The price the order is meant to act at.</summary>
    public decimal ActingPrice => TriggerPrice ?? LimitPrice;
}

/// <summary>Current orders together with potentially bounded historical status records.</summary>
/// <param name="OpenOrdersComplete">
/// True only when every current open order in the adapter's supported perpetual scope was read without
/// truncation or unsupported omissions. This does not assert complete order history or an atomic observation.
/// False means unknown or incomplete; absence must not establish cancellation or missing protection.
/// Even when true, absence does not establish a terminal status, and Orders can retain historical open statuses.
/// </param>
public sealed record VenueOrderReadResult(IReadOnlyList<VenueOrder> Orders, DateTimeOffset ObservedAtUtc, string Notice,
    bool OpenOrdersComplete = false);
