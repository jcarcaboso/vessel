using Vessel.Application.Sizing;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Review;

public sealed record ReviewQuery(string Period = "month", string Portfolio = "all", Guid? AccountId = null,
    string? Instrument = null, int Offset = 0);

/// <summary>One repeatable-read snapshot of the owner's enabled accounts and retained execution facts.</summary>
public sealed record ReviewFacts(IReadOnlyList<Portfolio> Portfolios, IReadOnlyList<Account> Accounts,
    IReadOnlyList<ClosedPlayFacts> ClosedPlays, int OpenPlays, int UnassignedFills, DateTimeOffset? FirstFillAtUtc,
    IReadOnlySet<Guid>? IncompleteOrderPlayIds = null);

public interface IReviewStore
{
    Task<ReviewFacts> ReadAsync(ReviewQuery query, DateTimeOffset asOf, CancellationToken ct);
}

public sealed record ReviewPortfolioDto(string Id, string Name);
public sealed record ReviewAccountDto(Guid Id, string Name, Guid? PortfolioId, string VenueId,
    DateTimeOffset? LastSyncedAtUtc, string SyncStatus, string? HistoryNotice);
public sealed record ReviewOptionsDto(IReadOnlyList<ReviewPortfolioDto> Portfolios,
    IReadOnlyList<ReviewAccountDto> Accounts, IReadOnlyList<string> Instruments);
public sealed record ReviewMetricsDto(int Count, int Wins, int Losses, int Scratches, string? Net,
    string? Batting, string? AverageGain, string? AverageLoss, string? Payoff, string? ProfitFactor,
    string? AverageWin, string? AverageLossUsd, string? Expectancy, string? AverageR,
    int RiskCount, int Reviewed, string? Drawdown, int MaxWins, int MaxLosses);
public sealed record ReviewPeriodDto(string Id, int Count, string? Net);
public sealed record ReviewGroupDto(string Id, string Name, string Detail, ReviewMetricsDto Metrics);
public sealed record ReviewGroupsDto(IReadOnlyList<ReviewGroupDto> Portfolios, IReadOnlyList<ReviewGroupDto> Accounts,
    IReadOnlyList<ReviewGroupDto> Assets);
public sealed record ReviewPointDto(DateTimeOffset AtUtc, string Net, string Cumulative, string Drawdown, int Count);
public sealed record ReviewPlayDto(Guid Id, string Title, Guid AccountId, string AccountName, string VenueId,
    string Instrument, DateTimeOffset ClosedAtUtc, string Net, string ReturnPercent, string? RMultiple, bool Reviewed);
public sealed record ReviewCoverageDto(int ClosedCandidates, int IncompleteFees, int IncompleteExecutions, int OpenPlays,
    int UnassignedFills, DateTimeOffset? FirstFillAtUtc, string Notice);
public sealed record ReviewDto(DateTimeOffset AsOfUtc, DateTimeOffset? FromUtc, string Period, string Currency,
    ReviewOptionsDto Options, IReadOnlyList<ReviewPeriodDto> Periods, ReviewMetricsDto Metrics,
    IReadOnlyList<ReviewPointDto> Series, int BucketDays, ReviewGroupsDto Groups, ReviewCoverageDto Coverage,
    IReadOnlyList<ReviewPlayDto> Plays, int Offset, int? NextOffset);
