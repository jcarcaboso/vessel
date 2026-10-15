using System.Text.Json.Serialization;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Application.Venues;
using Vessel.Application.Monitoring;

namespace Vessel.Application.Plays.Execution;

/// <summary>Links an order to a plan level: role entry with its entry, stop or target with its entry and level, or exit.</summary>
public sealed record LinkOrderRequest(
    [property: JsonRequired] string OrderId,
    [property: JsonRequired] string Role,
    string? EntryId = null,
    string? LevelId = null);

public sealed record ExecutionOrderDto(string OrderId, string Side, string OrderType, string LimitPrice, string? TriggerPrice,
    bool ReduceOnly, bool IsPositionTpsl, string OriginalSize, string RemainingSize, DateTimeOffset PlacedAtUtc,
    string Status, string VenueStatus, DateTimeOffset StatusAtUtc);

public sealed record ExecutionFillDto(string SourceFillId, string Direction, string Price, string Quantity, string Fee,
    string FeeToken, string ClosedPnlUsd, DateTimeOffset OccurredAtUtc, string Side, string PositionEffect, string PnlBasis);

public sealed record OrderLinkDto(Guid Id, string Role, string? EntryId, string? LevelId, string State, string Source,
    ExecutionOrderDto? Order, string FilledQuantity, IReadOnlyList<ExecutionFillDto> Fills);

public sealed record EntryProgressDto(string EntryId, string FilledQuantity, string? AverageFillPrice, int RestingOrders);

public sealed record FeeTotalDto(string Token, string Amount);

/// <summary>
/// Quantities are base units summed from linked fills; closed PnL and fees are venue-reported.
/// <paramref name="ClosedPnlBasis"/> is gross (fees separate), net-of-fee (fees already taken off) or mixed.
/// </summary>
public sealed record ExecutionTotalsDto(string EnteredQuantity, string ExitedQuantity, string OpenQuantity,
    string ClosedPnlUsd, string ClosedPnlBasis, IReadOnlyList<FeeTotalDto> Fees);

/// <summary><paramref name="Issues"/> say why linked fills cannot settle the play; their quantities stay out of the totals when they contradict it.</summary>
public sealed record PlayExecutionDto(Guid PlayId, string Status, bool Tracked, string? Reason, DateTimeOffset? CheckedAtUtc,
    ExecutionTotalsDto Totals, IReadOnlyList<EntryProgressDto> Entries, IReadOnlyList<OrderLinkDto> Links,
    IReadOnlyList<OrderLinkDto> Suggestions, IReadOnlyList<ExecutionOrderDto> UnlinkedOrders, string Notice, IReadOnlyList<string> Issues)
{
    public AccountMonitorDto? Monitor { get; init; }
    public IReadOnlyList<MonitorDiscrepancyDto> Discrepancies { get; init; } = [];
}

// Application owns this bounded port; EF details stay in Persistence. Reads are owner-filtered.
public interface IPlayExecutionStore
{
    Task<Account?> AccountAsync(Guid id, CancellationToken ct);
    /// <summary>
    /// Planned, paused and open Plays of the account, tracked for status changes with their committed values and locked
    /// until the transaction ends, so owner status and plan changes take turns with linking.
    /// </summary>
    Task<List<Play>> ActivePlaysAsync(Guid accountId, CancellationToken ct);
    Task<List<ImportedOrder>> OrdersAsync(Guid accountId, CancellationToken ct);
    /// <summary>Inserts new orders and updates the status of known ones.</summary>
    Task UpsertOrdersAsync(Account account, IReadOnlyList<VenueOrder> orders, DateTimeOffset observedAt, CancellationToken ct);
    Task<List<PlayOrderLink>> LinksAsync(Guid accountId, CancellationToken ct);
    Task<List<ImportedFill>> FillsAsync(Guid accountId, IReadOnlyCollection<string> orderIds, CancellationToken ct);
    void Add(PlayOrderLink link);
    void Add(PlayStatusChange change);
    /// <summary>Persists through the active unit of work, without committing.</summary>
    Task SaveAsync(CancellationToken ct);
    /// <summary>Requires an active unit of work; serializes reconciliation across requests and processes until it completes.</summary>
    Task<T> WithAccountLockAsync<T>(Guid accountId, Func<Task<T>> action, CancellationToken ct);
}
