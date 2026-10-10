using Microsoft.EntityFrameworkCore;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

public sealed class ExecutionStore(VesselDbContext db) : IPlayExecutionStore
{
    public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => db.Accounts.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<List<Play>> ActivePlaysAsync(Guid accountId, CancellationToken ct) => db.Plays
        .Where(p => p.AccountId == accountId && (p.Status == PlayStatus.Planned || p.Status == PlayStatus.Paused || p.Status == PlayStatus.Open))
        .OrderBy(p => p.CreatedAtUtc).ThenBy(p => p.Id).ToListAsync(ct);
    public Task<List<ImportedOrder>> OrdersAsync(Guid accountId, CancellationToken ct) =>
        db.Orders.Where(o => o.AccountId == accountId).OrderBy(o => o.PlacedAtUtc).ThenBy(o => o.OrderId).ToListAsync(ct);
    public Task<List<PlayOrderLink>> LinksAsync(Guid accountId, CancellationToken ct) =>
        db.OrderLinks.Where(l => l.AccountId == accountId).OrderBy(l => l.CreatedAtUtc).ThenBy(l => l.Id).ToListAsync(ct);
    public Task<List<ImportedFill>> FillsAsync(Guid accountId, IReadOnlyCollection<string> orderIds, CancellationToken ct) =>
        db.Fills.Where(f => f.AccountId == accountId && orderIds.Contains(f.OrderId)).OrderBy(f => f.OccurredAtUtc).ThenBy(f => f.Id)
            .AsNoTracking().ToListAsync(ct);
    public void Add(PlayOrderLink link) => db.OrderLinks.Add(link);
    public void Add(PlayStatusChange change) => db.StatusChanges.Add(change);

    public async Task UpsertOrdersAsync(Account account, IReadOnlyList<VenueOrder> orders, DateTimeOffset observedAt, CancellationToken ct)
    {
        var ids = orders.Select(o => o.OrderId).Distinct().ToList();
        var known = await db.Orders.Where(o => o.AccountId == account.Id && ids.Contains(o.OrderId)).ToDictionaryAsync(o => o.OrderId, ct);
        foreach (var order in orders)
        {
            if (!known.TryGetValue(order.OrderId, out var row))
            {
                row = new ImportedOrder { Id = Guid.NewGuid(), OwnerId = account.OwnerId, AccountId = account.Id, OrderId = order.OrderId };
                db.Orders.Add(row);
                known[order.OrderId] = row;
            }
            // An older status never replaces a newer one.
            else if (order.StatusAtUtc < row.StatusAtUtc) continue;
            row.ContractId = order.ContractId;
            row.VenueContractId = order.VenueContractId;
            row.Side = order.Side;
            row.OrderType = order.OrderType;
            row.LimitPrice = order.LimitPrice;
            row.TriggerPrice = order.TriggerPrice;
            row.ReduceOnly = order.ReduceOnly;
            row.IsPositionTpsl = order.IsPositionTpsl;
            row.OriginalSize = order.OriginalSize;
            row.RemainingSize = order.RemainingSize;
            row.PlacedAtUtc = order.PlacedAtUtc.ToUniversalTime();
            row.Status = order.Status.ToString().ToLowerInvariant();
            row.VenueStatus = order.VenueStatus;
            row.StatusAtUtc = order.StatusAtUtc.ToUniversalTime();
            row.ObservedAtUtc = observedAt.ToUniversalTime();
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            throw new WorkspaceException(409, "This Play changed elsewhere. Reload it and check the venue again.");
        }
    }

    public async Task<T> WithAccountLockAsync<T>(Guid accountId, Func<Task<T>> action, CancellationToken ct)
    {
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var key = "vessel-execution:" + accountId;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        var result = await action();
        if (transaction is not null) await transaction.CommitAsync(ct);
        return result;
    }
}
