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
    /// <summary>
    /// Safety bound on one instrument's fills after its earliest open entry. Exceeding it leaves only that instrument's
    /// unlinked-fill check unknown; it never disables the account's other checks.
    /// </summary>
    private const int MaxCandidateFills = 10000;
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
    public async Task<MonitorDiscrepancyFacts> LoadAsync(Guid accountId, DateTimeOffset recentSince, IReadOnlyCollection<string> restingOrderIds,
        CancellationToken ct)
    {
        work.RequireActive();
        // Only the subjects the checks can still report on, never the account's lifetime history. Callers hold the
        // account row lock, which every Play writer takes first (PlayStore.WithPlayLockAsync, ExecutionStore), so the
        // Play rows need no lock of their own here.
        var watches = db.Set<MonitorExitWatch>();
        var resting = restingOrderIds.ToArray();
        var records = db.Set<PlayDiscrepancy>();
        var plays = await db.Plays.Where(p => p.AccountId == accountId && p.InstrumentSource == InstrumentSource.Venue &&
                p.Origin == PlayOrigin.Planned && p.Status != PlayStatus.Draft &&
                (p.Status == PlayStatus.Planned || p.Status == PlayStatus.Paused || p.Status == PlayStatus.Open ||
                    p.EndedAtUtc >= recentSince ||
                    // Same terminal watch as MonitorStore eligibility: a linked order not yet proven absent.
                    db.OrderLinks.Any(l => l.PlayId == p.Id && l.State == OrderLinkState.Linked && !watches.Any(e =>
                        e.LinkId == l.Id && e.ResolvedAtUtc != null && e.LinkRevisionAtUtc >= l.UpdatedAtUtc && e.OrderId == l.OrderId)) ||
                    // Evaluation membership, independent of scheduling: tracked records, even unverifiable ones.
                    records.Any(d => d.AccountId == accountId && d.PlayId == p.Id && (d.State == DiscrepancyLifecycle.Candidate ||
                        d.State == DiscrepancyLifecycle.Open || d.PendingFingerprint != null ||
                        d.PublishedTransition == DiscrepancyLifecycle.Opened || d.PublishedTransition == DiscrepancyLifecycle.Unverifiable)) ||
                    db.OrderLinks.Any(l => l.PlayId == p.Id && l.State == OrderLinkState.Linked && resting.Contains(l.OrderId))))
            .OrderBy(x => x.Id).ToListAsync(ct);
        var ids = plays.Select(x => x.Id).ToArray();
        var links = await db.OrderLinks.Where(x => x.AccountId == accountId && ids.Contains(x.PlayId))
            .OrderBy(x => x.Id).ToListAsync(ct);
        var linked = links.Where(x => x.State == OrderLinkState.Linked).ToArray();
        var orderIds = linked.Select(x => x.OrderId).Distinct().ToArray();
        var orders = await db.Orders.Where(x => x.AccountId == accountId && orderIds.Contains(x.OrderId)).ToListAsync(ct);
        var fills = await db.Fills.Where(x => x.AccountId == accountId && orderIds.Contains(x.OrderId))
            .OrderBy(x => x.Id).AsNoTracking().ToListAsync(ct);
        // Unlinked-fill candidates: fills on an Open Play's instrument after the earliest linked entry fill there.
        var open = plays.Where(x => x.Status == PlayStatus.Open && x.ContractId is not null).ToDictionary(x => x.Id, x => x.ContractId!);
        var entries = linked.Where(x => x.Role == OrderLinkRole.Entry && open.ContainsKey(x.PlayId))
            .ToLookup(x => x.OrderId, x => open[x.PlayId], StringComparer.Ordinal);
        var earliest = fills.SelectMany(f => entries[f.OrderId].Select(contract => (Contract: contract, f.OccurredAtUtc)))
            .GroupBy(x => x.Contract, StringComparer.Ordinal).ToDictionary(x => x.Key, x => x.Min(y => y.OccurredAtUtc), StringComparer.Ordinal);
        var loaded = fills.Select(x => x.Id).ToHashSet();
        var truncated = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (contract, since) in earliest.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            var candidates = await db.Fills.Where(x => x.AccountId == accountId && x.ContractId == contract && x.OccurredAtUtc > since)
                .OrderBy(x => x.OccurredAtUtc).ThenBy(x => x.Id).Take(MaxCandidateFills + 1).AsNoTracking().ToListAsync(ct);
            if (candidates.Count > MaxCandidateFills) truncated.Add(contract);
            fills.AddRange(candidates.Where(x => loaded.Add(x.Id)));
        }
        // Assignment is account-wide (retrospective Plays included), but only the loaded fills' orders matter.
        var fillOrders = fills.Select(x => x.OrderId).Distinct().ToArray();
        var assignments = await db.OrderLinks.Where(x => x.AccountId == accountId && fillOrders.Contains(x.OrderId) &&
                (x.State == OrderLinkState.Linked || x.State == OrderLinkState.Suggested))
            .OrderBy(x => x.Id).AsNoTracking().ToListAsync(ct);
        return new(plays, links, orders, fills, true, assignments, true, truncated);
    }
}
