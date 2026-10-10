using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vessel.Application.Workspace;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Persistence;

public sealed class WorkspaceStore(VesselDbContext db) : IWorkspaceStore
{
    public Task<List<Portfolio>> PortfoliosAsync(CancellationToken ct) => db.Portfolios.OrderBy(x => x.Name).ThenBy(x => x.Id).ToListAsync(ct);
    public Task<List<Account>> AccountsAsync(CancellationToken ct) => db.Accounts.OrderBy(x => x.Name).ThenBy(x => x.Id).ToListAsync(ct);
    public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => db.Accounts.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<bool> SourceExistsAsync(string venueId, string sourceId, CancellationToken ct) =>
        db.Accounts.AnyAsync(a => a.VenueId == venueId && a.SourceId == sourceId, ct);
    public Task<AccountSnapshot?> SnapshotAsync(Guid id, CancellationToken ct) => db.Snapshots
        .Where(s => s.AccountId == id && db.Accounts.Any(a => a.Id == s.AccountId && a.IsEnabled))
        .Include(s => s.Positions).Include(s => s.Stablecoins).AsSplitQuery().AsNoTracking().SingleOrDefaultAsync(ct);
    public Task<List<AccountSnapshot>> SnapshotsAsync(CancellationToken ct) => db.Snapshots.Where(s => db.Accounts.Any(a => a.Id == s.AccountId && a.IsEnabled)).Include(x => x.Positions).Include(x => x.Stablecoins).AsSplitQuery().AsNoTracking().ToListAsync(ct);
    public Task<List<ImportedFill>> FillsAsync(Guid? accountId, int limit, CancellationToken ct) => db.Fills
        .Where(x => (accountId == null || x.AccountId == accountId) && db.Accounts.Any(a => a.Id == x.AccountId && a.IsEnabled)).OrderByDescending(x => x.OccurredAtUtc).ThenBy(x => x.Id)
        .Take(limit).AsNoTracking().ToListAsync(ct);
    public Task<int> FillCountAsync(CancellationToken ct) => db.Fills.Where(f => db.Accounts.Any(a => a.Id == f.AccountId && a.IsEnabled)).CountAsync(ct);
    public async Task AddPortfolioAsync(Portfolio portfolio, CancellationToken ct) { db.Portfolios.Add(portfolio); await db.SaveChangesAsync(ct); }
    public async Task AddAccountAsync(Account account, CancellationToken ct)
    {
        db.Accounts.Add(account);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException
        { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "UX_accounts_owner_venue_source" })
        {
            throw new WorkspaceException(409, "An account for this venue and source already exists. Manage or re-enable that account.");
        }
    }
    public async Task SaveAsync(CancellationToken ct) => await db.SaveChangesAsync(ct);

    public async Task<T> WithManagementLockAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // Grouping mutations for an owner acquire this before any account row lock.
        // This avoids assignment/portfolio-delete lock-order inversions. It is cross-process,
        // transaction-scoped and contains no provider I/O; ordinary sync does not take it.
        var key = "vessel-management:" + db.CurrentOwnerId;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        var result = await action();
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task DeletePortfolioAsync(Guid id, CancellationToken ct)
    {
        // Lock the parent as well as all accounts. PostgreSQL FK key-share locks serialize
        // concurrent assignments (even privileged SQL) against this parent deletion.
        var portfolios = await db.Portfolios.FromSqlInterpolated(
            $"SELECT * FROM portfolios WHERE \"Id\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} FOR UPDATE").ToListAsync(ct);
        var portfolio = portfolios.SingleOrDefault() ?? throw new WorkspaceException(404, "Portfolio not found.");
        var accounts = await db.Accounts.FromSqlInterpolated(
            $"SELECT * FROM accounts WHERE \"PortfolioId\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} ORDER BY \"Id\" FOR UPDATE").ToListAsync(ct);
        foreach (var account in accounts)
        {
            await db.Entry(account).ReloadAsync(ct);
            account.UpdateSettings(account.Name, null, account.IsEnabled);
        }
        await db.SaveChangesAsync(ct);
        db.Portfolios.Remove(portfolio);
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAccountAsync(Account account, CancellationToken ct)
    {
        if (await db.Plays.AnyAsync(p => p.AccountId == account.Id, ct))
            throw new WorkspaceException(409, "This account has linked Plays and cannot be deleted.");
        // Explicit owner-filtered deletes run under the locked account's transaction.
        // Positions cascade from the snapshot, never from trading intent.
        await db.Fills.Where(f => f.AccountId == account.Id).ExecuteDeleteAsync(ct);
        await db.Orders.Where(o => o.AccountId == account.Id).ExecuteDeleteAsync(ct);
        await db.Snapshots.Where(s => s.AccountId == account.Id).ExecuteDeleteAsync(ct);
        // Bulk deletes do not update EF's tracker. Detach only this account's deleted
        // facts so a context that previously refreshed it cannot sever required FKs.
        foreach (var entry in db.ChangeTracker.Entries().ToList())
        {
            var deleted = entry.Entity switch
            {
                ImportedFill f => f.OwnerId == account.OwnerId && f.AccountId == account.Id,
                ImportedOrder o => o.OwnerId == account.OwnerId && o.AccountId == account.Id,
                AccountSnapshot s => s.OwnerId == account.OwnerId && s.AccountId == account.Id,
                AccountPosition p => p.OwnerId == account.OwnerId && p.AccountId == account.Id,
                Vessel.Domain.Credentials.AccountCredential c => c.OwnerId == account.OwnerId && c.AccountId == account.Id,
                _ => false
            };
            if (deleted) entry.State = EntityState.Detached;
        }
        db.Accounts.Remove(account);
        await db.SaveChangesAsync(ct);
    }

    public async Task<T> WithAccountLockAsync<T>(Guid id, Func<Account, Task<T>> action, CancellationToken ct)
    {
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        // PostgreSQL row lock serializes refreshes across API processes, not just this host.
        // Owner is explicit in raw SQL as well as the global query filter.
        var accounts = await db.Accounts.FromSqlInterpolated(
            $"SELECT * FROM accounts WHERE \"Id\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} FOR UPDATE").ToListAsync(ct);
        var account = accounts.SingleOrDefault() ?? throw new WorkspaceException(404, "Account not found.");
        // A scoped context could already track this account before waiting on the lock.
        await db.Entry(account).ReloadAsync(ct);
        var result = await action(account);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return result;
    }

    public async Task SaveRefreshAsync(Account account, PerpetualVenueReadResult result, CancellationToken ct)
    {
        var observation = result.Snapshot;
        var snapshot = await db.Snapshots.Include(x => x.Positions).Include(x => x.Stablecoins).AsSplitQuery().SingleOrDefaultAsync(x => x.AccountId == account.Id, ct);
        var replacePerps = snapshot is null || observation.ObservedAtUtc > snapshot.ObservedAtUtc;
        var wallet = observation.StablecoinWallet;
        var replaceWallet = wallet is not null &&
            (snapshot?.StablecoinsObservedAtUtc is null || wallet.ObservedAtUtc > snapshot.StablecoinsObservedAtUtc);
        if (snapshot is null)
        {
            snapshot = new AccountSnapshot { OwnerId = account.OwnerId, AccountId = account.Id };
            db.Snapshots.Add(snapshot);
        }
        else if (replacePerps || replaceWallet)
        {
            if (replacePerps)
            {
                db.Positions.RemoveRange(snapshot.Positions);
                snapshot.Positions.Clear();
            }
            if (replaceWallet)
            {
                db.Stablecoins.RemoveRange(snapshot.Stablecoins);
                snapshot.Stablecoins.Clear();
            }
            // Delete only the advancing ledger's composite keys before replacement.
            await db.SaveChangesAsync(ct);
        }
        // Equal timestamps are no-ops for that ledger. Stale state never prevents
        // importing new fill identities, or updating an independently newer wallet.
        if (replacePerps)
        {
            snapshot.ObservedAtUtc = observation.ObservedAtUtc.ToUniversalTime();
            snapshot.ValueScope = observation.ValueScope;
            snapshot.AccountValueUsd = observation.AccountValueUsd;
            snapshot.WithdrawableUsd = observation.WithdrawableUsd;
            snapshot.MarginUsedUsd = observation.MarginUsedUsd;
            snapshot.Positions = observation.Positions.Select(p => new AccountPosition
            {
                OwnerId = account.OwnerId,
                AccountId = account.Id,
                ContractId = p.ContractId,
                VenueContractId = p.VenueContractId,
                SignedQuantity = p.SignedQuantity,
                EntryPrice = p.EntryPrice,
                UnrealizedPnlUsd = p.UnrealizedPnlUsd,
                MarginUsedUsd = p.MarginUsedUsd,
                Leverage = p.Leverage
            }).ToList();
        }
        if (replaceWallet)
        {
            snapshot.StablecoinsObservedAtUtc = wallet!.ObservedAtUtc.ToUniversalTime();
            snapshot.AccountMode = wallet.AccountMode;
            snapshot.StablecoinScope = wallet.Scope;
            snapshot.Stablecoins = wallet.Balances.Select(balance => new AccountStablecoin
            {
                OwnerId = account.OwnerId,
                AccountId = account.Id,
                TokenIndex = balance.TokenIndex,
                TokenId = balance.TokenId,
                Symbol = balance.Symbol,
                Total = balance.Total,
                Held = balance.Held,
                Available = balance.Available
            }).ToList();
        }
        var incomingSourceIds = result.Fills.Select(f => f.SourceFillId).Distinct().ToArray();
        var existing = (await db.Fills.Where(f => f.AccountId == account.Id && incomingSourceIds.Contains(f.SourceFillId))
            .Select(f => new { f.ContractId, f.SourceFillId }).ToListAsync(ct))
            .Select(f => (f.ContractId, f.SourceFillId)).ToHashSet();
        foreach (var f in result.Fills)
        {
            if (!existing.Add((f.ContractId, f.SourceFillId))) continue;
            db.Fills.Add(new ImportedFill
            {
                Id = Guid.NewGuid(),
                OwnerId = account.OwnerId,
                AccountId = account.Id,
                ContractId = f.ContractId,
                VenueContractId = f.VenueContractId,
                SourceFillId = f.SourceFillId,
                Side = f.Side,
                Direction = f.Direction,
                PositionEffect = f.PositionEffect,
                Price = f.Price,
                Quantity = f.Quantity,
                Fee = f.Fee,
                FeeToken = f.FeeToken,
                FeeBasis = f.FeeBasis,
                ClosedPnlUsd = f.ClosedPnlUsd,
                PnlBasis = f.PnlBasis,
                OccurredAtUtc = f.OccurredAtUtc.ToUniversalTime(),
                OrderId = f.OrderId,
                TransactionHash = f.TransactionHash
            });
        }
        // RawJson intentionally never crosses into journal persistence or logs.
        account.RecordSync(snapshot.ObservedAtUtc, result.HistoryNotice);
        await db.SaveChangesAsync(ct);
    }
}
