using System.Data;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Review;
using Vessel.Application.Sizing;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class ReviewStore(VesselDbContext db, ISizingStore sizing) : IReviewStore
{
    public async Task<ReviewFacts> ReadAsync(ReviewQuery query, DateTimeOffset asOf, CancellationToken ct)
    {
        // One database snapshot for links, outcomes, membership and coverage during concurrent sync/management.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var portfolios = await db.Portfolios.AsNoTracking().ToListAsync(ct);
        var accounts = await db.Accounts.Where(a => a.IsEnabled).AsNoTracking().ToListAsync(ct);
        var ids = accounts.Where(a => (query.AccountId is null || a.Id == query.AccountId) &&
            (query.Portfolio == "all" || query.Portfolio == "unassigned" && a.PortfolioId is null ||
                a.PortfolioId?.ToString() == query.Portfolio)).Select(a => a.Id).ToList();
        var closed = await sizing.ClosedPlaysAsync(ct);
        // Known filled orders with missing executions come with the closed Plays, as sizing reads them.
        var incomplete = closed.Where(p => p.IncompleteOrders is { Count: > 0 }).Select(p => p.Play.Id).ToHashSet();
        var open = await db.Plays.CountAsync(p => ids.Contains(p.AccountId) && p.Status == PlayStatus.Open &&
            (query.Instrument == null || p.ContractId == query.Instrument), ct);
        var fills = db.Fills.Where(f => ids.Contains(f.AccountId) && f.OccurredAtUtc <= asOf &&
            (query.Instrument == null || f.ContractId == query.Instrument));
        var first = await fills.Select(f => (DateTimeOffset?)f.OccurredAtUtc).MinAsync(ct);
        var from = ReviewService.From(query.Period, asOf);
        var unassigned = await fills.CountAsync(f => (from == null || f.OccurredAtUtc > from) &&
            !db.OrderLinks.Any(l => l.AccountId == f.AccountId && l.OrderId == f.OrderId &&
                l.State == OrderLinkState.Linked && db.Plays.Any(p => p.Id == l.PlayId && p.ContractId == f.ContractId)), ct);
        await transaction.CommitAsync(ct);
        return new(portfolios, accounts, closed, open, unassigned, first, incomplete);
    }
}
