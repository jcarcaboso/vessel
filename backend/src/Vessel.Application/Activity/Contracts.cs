using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Activity;

public sealed record ActivityFacts(IReadOnlyList<Account> Accounts, IReadOnlyList<ImportedFill> Fills,
    IReadOnlyList<AccountSnapshot> Snapshots, IReadOnlyDictionary<Guid, Guid> FillPlayIds);
public interface IActivityStore
{
    // All retained facts, not the overview's most recent 100; owner-scoped and enabled accounts only.
    Task<ActivityFacts> ReadAsync(Guid? accountId, CancellationToken ct);
}
public sealed record OperationFillDto(FillDto Fill, string Role, string Quantity, string Fee, string ClosedPnlUsd);
public sealed record OperationFeeDto(string Token, string Amount);
public sealed record ActivityOperationDto(string Id, Guid AccountId, string ContractId, string? Direction, string Status,
    DateTimeOffset? OpenedAtUtc, DateTimeOffset? ClosedAtUtc, DateTimeOffset LastOccurredAtUtc,
    string? Quantity, string? TotalEnteredQuantity, string? TotalExitedQuantity, string? OpenQuantity,
    string? AverageEntryPrice, string? AverageExitPrice, int EntryOrderCount, int ExitOrderCount, int FillCount,
    string ReportedClosedPnlUsd, string StablecoinFeesNominalUsd, IReadOnlyList<OperationFeeDto> OtherFees,
    string? NetResultUsd, string PnlBasis, Guid? PlayId, string PlayAssociation,
    IReadOnlyList<string> Coverage, IReadOnlyList<OperationFillDto> Fills, int OmittedFillCount = 0);
public sealed record ActivityCoverageDto(Guid AccountId, string? ContractId, string Notice);
public sealed record ActivityDto(IReadOnlyList<ActivityOperationDto> Operations, int TotalOperationCount, int RetainedFillCount,
    int OmittedOperationCount, IReadOnlyList<ActivityCoverageDto> Coverage, string ScopeNote);
