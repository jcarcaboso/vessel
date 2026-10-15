using Vessel.Application.Common;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Monitoring;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class MonitorDiscrepancyStore(VesselDbContext db, UnitOfWork work) : IMonitorDiscrepancyStore
{
    private const int MaxPlays = 2000, MaxLinks = 10000, MaxFills = 50000;
    public Task<Account?> AccountAsync(Guid accountId, CancellationToken ct) =>
        db.Accounts.SingleOrDefaultAsync(x => x.Id == accountId, ct);
    public Task<Play?> PlayAsync(Guid playId, CancellationToken ct) => db.Plays.SingleOrDefaultAsync(x => x.Id == playId, ct);
    public async Task<IReadOnlyList<PlayDiscrepancy>> RecordsAsync(Guid accountId, CancellationToken ct) =>
        await db.Set<PlayDiscrepancy>().Where(x => x.AccountId == accountId).OrderBy(x => x.Id).ToListAsync(ct);
    public void Add(PlayDiscrepancy record) { work.RequireActive(); db.Add(record); }
    public async Task LockAsync(Guid accountId, CancellationToken ct)
    {
        work.RequireActive();
        var accounts = await db.Accounts.FromSqlInterpolated($"SELECT * FROM accounts WHERE \"Id\" = {accountId} AND \"OwnerId\" = {db.CurrentOwnerId} FOR UPDATE").ToListAsync(ct);
        if (accounts.Count != 1) throw new ProblemException(404, "Account not found.");
    }
    public async Task<MonitorDiscrepancyFacts> LoadAsync(Guid accountId, CancellationToken ct)
    {
        work.RequireActive();
        // Bounded retained facts, not venue lifetime history. Truncated subject facts are not evaluated;
        // account-wide assignment coverage is checked separately for unlinked fills.
        var plays = await db.Plays.FromSqlInterpolated($"""
            SELECT * FROM plays WHERE "OwnerId" = {db.CurrentOwnerId} AND "AccountId" = {accountId}
            AND "InstrumentSource" = 'Venue' AND "Origin" = 'Planned' AND "Status" <> 'Draft'
            ORDER BY "Id" LIMIT {MaxPlays + 1} FOR NO KEY UPDATE
            """).ToListAsync(ct);
        var ids = plays.Select(x => x.Id).ToArray();
        var links = await db.OrderLinks.Where(x => x.AccountId == accountId && ids.Contains(x.PlayId))
            .OrderBy(x => x.Id).Take(MaxLinks + 1).ToListAsync(ct);
        // Assignment is account-wide even though only planned Plays are monitor subjects.
        var assignments = await db.OrderLinks.Where(x => x.AccountId == accountId &&
                (x.State == OrderLinkState.Linked || x.State == OrderLinkState.Suggested))
            .OrderBy(x => x.Id).Take(MaxLinks + 1).AsNoTracking().ToListAsync(ct);
        var orderIds = links.Select(x => x.OrderId).Distinct().ToArray();
        var orders = await db.Orders.Where(x => x.AccountId == accountId && orderIds.Contains(x.OrderId)).ToListAsync(ct);
        var fills = await db.Fills.Where(x => x.AccountId == accountId).OrderByDescending(x => x.OccurredAtUtc)
            .ThenBy(x => x.Id).Take(MaxFills + 1).AsNoTracking().ToListAsync(ct);
        return new(plays, links, orders, fills, plays.Count <= MaxPlays && links.Count <= MaxLinks && fills.Count <= MaxFills,
            assignments, assignments.Count <= MaxLinks);
    }
}
