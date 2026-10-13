using System.Data;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Activity;
using Vessel.Application.Workspace;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class ActivityStore(VesselDbContext db) : IActivityStore
{
    public async Task<ActivityFacts> ReadAsync(Guid? accountId, CancellationToken ct, IReadOnlySet<Guid>? accountIds = null)
    {
        if (accountIds is { Count: 0 }) return new([], [], [], new Dictionary<Guid, Guid>());
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        if (accountId is { } id && !await db.Accounts.AnyAsync(a => a.Id == id, ct))
            throw new WorkspaceException(404, "Account not found.");
        var query = db.Accounts.Where(a => a.IsEnabled && (accountId == null || a.Id == accountId));
        if (accountIds is not null)
        {
            var selectedIds = accountIds.ToArray();
            query = query.Where(a => selectedIds.Contains(a.Id));
        }
        var accounts = await query.AsNoTracking().ToListAsync(ct);
        var ids = accounts.Select(a => a.Id).ToArray();
        var fills = await db.Fills.Where(f => ids.Contains(f.AccountId)).AsNoTracking().ToListAsync(ct);
        var snapshots = await db.Snapshots.Where(s => ids.Contains(s.AccountId)).Include(s => s.Positions).AsNoTracking().ToListAsync(ct);
        var links = await db.OrderLinks.Where(l => ids.Contains(l.AccountId) && l.State == OrderLinkState.Linked).AsNoTracking().ToListAsync(ct);
        var byOrder = links.ToDictionary(l => (l.AccountId, l.OrderId), l => l.PlayId);
        var playIds = fills.Where(f => byOrder.ContainsKey((f.AccountId, f.OrderId)))
            .ToDictionary(f => f.Id, f => byOrder[(f.AccountId, f.OrderId)]);
        await transaction.CommitAsync(ct);
        return new(accounts, fills, snapshots, playIds);
    }
}
