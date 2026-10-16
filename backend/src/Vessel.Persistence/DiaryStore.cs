using Microsoft.EntityFrameworkCore;
using Vessel.Application.Activity;
using Vessel.Application.Plays;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

public sealed class DiaryStore(VesselDbContext db, UnitOfWork unitOfWork) : IDiaryStore
{
    public Task<T> WithRequestLockAsync<T>(Guid requestId, Func<Task<T>> action, CancellationToken ct) => unitOfWork.ParticipateAsync(async () =>
    {
        var key = $"vessel-diary-request:{db.CurrentOwnerId}:{requestId}";
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        var result = await action();
        return result;
    }, ct);
    public Task<DiaryRequest?> RequestAsync(Guid requestId, CancellationToken ct) =>
        db.DiaryRequests.AsNoTracking().SingleOrDefaultAsync(r => r.Id == requestId, ct);
    public Task<List<ManualExecution>> ManualAsync(Guid playId, CancellationToken ct) =>
        db.ManualExecutions.Where(r => r.PlayId == playId).OrderBy(r => r.OccurredAtUtc).ThenBy(r => r.Id).ToListAsync(ct);
    public Task<List<ManualExecutionHistory>> ManualHistoryAsync(Guid playId, CancellationToken ct) =>
        db.ManualExecutionHistory.Where(r => r.PlayId == playId).AsNoTracking().OrderBy(r => r.OccurredAtUtc).ThenBy(r => r.Id).ToListAsync(ct);
    public async Task<ActivityFacts> ActivityAsync(Guid accountId, CancellationToken ct)
    {
        var accounts = await db.Accounts.Where(a => a.Id == accountId && a.IsEnabled).AsNoTracking().ToListAsync(ct);
        var fills = await db.Fills.Where(f => f.AccountId == accountId).AsNoTracking().ToListAsync(ct);
        var snapshots = await db.Snapshots.Where(s => s.AccountId == accountId).Include(s => s.Positions).AsNoTracking().ToListAsync(ct);
        var funding = await db.FundingPayments.Where(p => p.AccountId == accountId).AsNoTracking().ToListAsync(ct);
        var links = await db.OrderLinks.Where(l => l.AccountId == accountId && l.State == OrderLinkState.Linked).AsNoTracking().ToListAsync(ct);
        var byOrder = links.ToDictionary(l => l.OrderId, l => l.PlayId);
        return new(accounts, fills, snapshots, fills.Where(f => byOrder.ContainsKey(f.OrderId)).ToDictionary(f => f.Id, f => byOrder[f.OrderId]))
        { FundingPayments = funding };
    }
    public Task<List<ImportedOrder>> OrdersAsync(Guid accountId, CancellationToken ct) =>
        db.Orders.Where(o => o.AccountId == accountId).AsNoTracking().ToListAsync(ct);
    public Task<List<PlayOrderLink>> LinksAsync(Guid accountId, CancellationToken ct) =>
        db.OrderLinks.Where(l => l.AccountId == accountId).AsNoTracking().ToListAsync(ct);
    public void Add(ManualExecution execution) { unitOfWork.RequireActive(); db.ManualExecutions.Add(execution); }
    public void Add(ManualExecutionHistory history) { unitOfWork.RequireActive(); db.ManualExecutionHistory.Add(history); }
    public void Add(DiaryRequest request) { unitOfWork.RequireActive(); db.DiaryRequests.Add(request); }
    public void Add(PlayOrderLink link) { unitOfWork.RequireActive(); db.OrderLinks.Add(link); }
}
