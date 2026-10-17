using Microsoft.EntityFrameworkCore;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Sizing;
using Vessel.Application.Plays;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;

namespace Vessel.Persistence;

public sealed class SizingStore(VesselDbContext db, UnitOfWork unitOfWork) : ISizingStore
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
        // Balanced fills alone cannot prove completeness: a known filled order may have only part (or none) of its executions retained.
        var known = (await db.Orders.Where(o => accounts.Contains(o.AccountId) && orders.Contains(o.OrderId)).AsNoTracking().ToListAsync(ct))
            .ToDictionary(o => (o.AccountId, o.OrderId));
        var linked = links.ToLookup(l => l.PlayId);
        var manual = (await db.ManualExecutions.Where(r => ids.Contains(r.PlayId)).AsNoTracking().ToListAsync(ct)).ToLookup(r => r.PlayId);
        return plays.Select(p => manual[p.Id].Any() ? ManualFacts(p, revisions[p.Id].ToList(), manual[p.Id]) :
            new ClosedPlayFacts(p, revisions[p.Id].ToList(),
            linked[p.Id].SelectMany(l => fills[(l.AccountId, l.OrderId)].Select(f => new LinkedFill(l.Role, f))).ToList(),
            linked[p.Id].Where(l => known.TryGetValue((l.AccountId, l.OrderId), out var order) &&
                ExecutionIntegrity.MissingExecutions(order, fills[(l.AccountId, l.OrderId)])).Select(l => l.OrderId).ToList())).ToList();
    }

    private static ClosedPlayFacts ManualFacts(Play play, IReadOnlyList<PlayPlanRevision> revisions, IEnumerable<ManualExecution> rows)
    {
        var ledger = ManualLedger.Calculate(play, rows);
        return new(play, revisions, ledger.Projection, [], true, ledger.FeesComplete);
    }

    public async Task<SizingSettings> SettingsForUpdateAsync(SizingSettings initial, CancellationToken ct)
    {
        unitOfWork.RequireActive();
        if (initial.OwnerId != db.CurrentOwnerId) throw new InvalidOperationException("Sizing settings belong to the current owner.");
        // A concurrent first write waits on the conflicting insert, then both read and lock the one committed row.
        await db.Database.ExecuteSqlInterpolatedAsync($@"INSERT INTO sizing_settings(""OwnerId"", ""RiskPercent"", ""UpdatedAtUtc"")
            VALUES({initial.OwnerId}, {initial.RiskPercent}, {initial.UpdatedAtUtc}) ON CONFLICT DO NOTHING", ct);
        return await db.SizingSettings.FromSqlInterpolated(
            $@"SELECT * FROM sizing_settings WHERE ""OwnerId"" = {db.CurrentOwnerId} FOR UPDATE").SingleAsync(ct);
    }

    public void Add(SizingSettings settings) { unitOfWork.RequireActive(); db.SizingSettings.Add(settings); }
    public Task SaveAsync(CancellationToken ct) => unitOfWork.SaveChangesAsync(ct);
}
