using Microsoft.EntityFrameworkCore;
using Vessel.Application.Sizing;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;

namespace Vessel.Persistence;

public sealed class SizingStore(VesselDbContext db) : ISizingStore
{
    public Task<SizingSettings?> SettingsAsync(CancellationToken ct) => db.SizingSettings.SingleOrDefaultAsync(ct);

    public async Task<List<ClosedPlayFacts>> ClosedPlaysAsync(CancellationToken ct)
    {
        var plays = await db.Plays.Where(p => p.Status == PlayStatus.Closed && db.Accounts.Any(a => a.Id == p.AccountId && a.IsEnabled))
            .AsNoTracking().ToListAsync(ct);
        if (plays.Count == 0) return [];
        var ids = plays.Select(p => p.Id).ToList();
        var revisions = (await db.PlanRevisions.Where(r => ids.Contains(r.PlayId)).AsNoTracking().ToListAsync(ct)).ToLookup(r => r.PlayId);
        var links = await db.OrderLinks.Where(l => ids.Contains(l.PlayId) && l.State == OrderLinkState.Linked).AsNoTracking().ToListAsync(ct);
        var accounts = links.Select(l => l.AccountId).Distinct().ToList();
        var orders = links.Select(l => l.OrderId).Distinct().ToList();
        var fills = (await db.Fills.Where(f => accounts.Contains(f.AccountId) && orders.Contains(f.OrderId)).AsNoTracking().ToListAsync(ct))
            .ToLookup(f => (f.AccountId, f.OrderId));
        var linked = links.ToLookup(l => l.PlayId);
        return plays.Select(p => new ClosedPlayFacts(p, revisions[p.Id].ToList(),
            linked[p.Id].SelectMany(l => fills[(l.AccountId, l.OrderId)].Select(f => new LinkedFill(l.Role, f))).ToList())).ToList();
    }

    public void Add(SizingSettings settings) => db.SizingSettings.Add(settings);
    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
