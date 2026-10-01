using System.Text.Json.Serialization;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Application.Venues;

namespace Vessel.Application.Workspace;

public sealed record CreatePortfolioRequest(string Name);
public sealed record CreateAccountRequest(Guid? PortfolioId, string Name, string VenueId, string? Address = null, string? ManualAccountValueUsd = null);
public sealed record RenamePortfolioRequest(string Name);
public sealed record UpdateAccountRequest(
    [property: JsonRequired] string Name,
    [property: JsonRequired] Guid? PortfolioId,
    [property: JsonRequired] bool IsEnabled,
    [property: JsonRequired] long ExpectedRevision);
public sealed record PortfolioDto(Guid Id, string Name, int AccountCount, string? TotalValueUsd, string ValueCoverage);
public sealed record AccountDto(Guid Id, Guid? PortfolioId, string Name, string VenueId, string? Address,
    string? AccountValueUsd, DateTimeOffset? LastSyncedAtUtc, string SyncStatus, string? LastSyncError,
    int PositionCount, string? HistoryNotice, bool IsEnabled, long SettingsRevision,
    string? AvailableStablecoinNominalUsd = null, string? StablecoinScope = null, string? AccountMode = null);
public sealed record PositionDto(string ContractId, string SignedQuantity, string EntryPrice,
    string UnrealizedPnlUsd, string MarginUsedUsd, int? Leverage);
public sealed record SnapshotDto(DateTimeOffset ObservedAtUtc, string ValueScope, string? AccountValueUsd,
    string? WithdrawableUsd, string? MarginUsedUsd, IReadOnlyList<PositionDto> Positions,
    StablecoinWalletDto? StablecoinWallet = null);
public sealed record StablecoinBalanceDto(string Symbol, int TokenIndex, string TokenId,
    string Total, string Held, string Available);
public sealed record StablecoinWalletDto(DateTimeOffset ObservedAtUtc, string AccountMode, string Scope,
    string TotalNominalUsd, string AvailableNominalUsd,
    IReadOnlyList<StablecoinBalanceDto> Balances, string Notice);
public sealed record FillDto(Guid Id, Guid AccountId, string ContractId, string Side, string Direction,
    string Price, string Quantity, string Fee, string FeeToken, string ClosedPnlUsd, DateTimeOffset OccurredAtUtc,
    string OrderId, string SourceFillId, string TransactionHash, Guid? PlayId = null);
public sealed record OverviewTotals(int PortfolioCount, int AccountCount, string? TotalAccountValueUsd,
    int ValuedAccountCount, int OpenPositionCount, int ImportedFillCount,
    string? AvailableStablecoinNominalUsd = null, int StablecoinAccountCount = 0);
public sealed record OverviewDto(IReadOnlyList<PortfolioDto> Portfolios, IReadOnlyList<AccountDto> Accounts,
    OverviewTotals Totals, IReadOnlyList<FillDto> RecentActivity, string ScopeNote);

public sealed class WorkspaceException(int statusCode, string detail) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;
}

// Application owns this bounded use-case port; EF and transaction details stay in Persistence.
public interface IWorkspaceStore
{
    Task<List<Portfolio>> PortfoliosAsync(CancellationToken ct);
    Task<List<Account>> AccountsAsync(CancellationToken ct);
    Task<Account?> AccountAsync(Guid id, CancellationToken ct);
    Task<AccountSnapshot?> SnapshotAsync(Guid id, CancellationToken ct);
    Task<bool> SourceExistsAsync(string venueId, string address, CancellationToken ct);
    Task<List<AccountSnapshot>> SnapshotsAsync(CancellationToken ct);
    Task<List<ImportedFill>> FillsAsync(Guid? accountId, int limit, CancellationToken ct);
    Task<int> FillCountAsync(CancellationToken ct);
    Task AddPortfolioAsync(Portfolio portfolio, CancellationToken ct);
    Task AddAccountAsync(Account account, CancellationToken ct);
    Task<T> WithAccountLockAsync<T>(Guid id, Func<Account, Task<T>> action, CancellationToken ct);
    Task SaveRefreshAsync(Account account, PerpetualVenueReadResult result, CancellationToken ct);
    // Management serializes owner grouping changes before acquiring account row locks.
    // Sync takes only the account lock, so independent venue reads can still run concurrently.
    Task<T> WithManagementLockAsync<T>(Func<Task<T>> action, CancellationToken ct);
    Task DeletePortfolioAsync(Guid id, CancellationToken ct);
    Task DeleteAccountAsync(Account account, CancellationToken ct);
    Task SaveAsync(CancellationToken ct);
}
