using Vessel.Application.Common;
using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Application.Monitoring;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class MonitorStore(VesselDbContext db, UnitOfWork unitOfWork, MonitorOptions? options = null) : IMonitorStore
{
    private readonly MonitorOptions settings = options ?? new();
    private IQueryable<MonitorAccount> Rows => db.Set<MonitorAccount>();
    private IQueryable<MonitorExitWatch> Exits => db.Set<MonitorExitWatch>();

    public async Task<MonitorCapture?> CaptureAsync(Guid accountId, CancellationToken ct)
    {
        var account = await db.Accounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == accountId, ct);
        if (account is null) return null;
        var purpose = account.VenueId + "-read-token";
        var credential = await db.AccountCredentials.AsNoTracking()
            .SingleOrDefaultAsync(c => c.AccountId == accountId && c.Purpose == purpose, ct);
        var revision = credential is null ? null : CredentialAttempt.RevisionOf(credential);
        var newestFill = await db.Fills.Where(f => f.AccountId == accountId)
            .MaxAsync(f => (DateTimeOffset?)f.OccurredAtUtc, ct);
        return new(account, revision, credential?.ExpiresAt, newestFill);
    }

    public async Task<IReadOnlyList<MonitorAccount>> ListAsync(CancellationToken ct) =>
        await Rows.AsNoTracking().Where(m => db.Accounts.Any(a => a.Id == m.AccountId && a.IsEnabled))
            .OrderBy(m => m.AccountId).Take(200).ToListAsync(ct);
    public Task<MonitorAccount?> FindAsync(Guid id, CancellationToken ct) =>
        Rows.AsNoTracking().SingleOrDefaultAsync(m => m.AccountId == id, ct);
    public Task<DateTimeOffset?> VenueRetryAtAsync(string venueId, CancellationToken ct) =>
        db.Set<MonitorVenueBudget>().Where(b => b.VenueId == venueId).Select(b => (DateTimeOffset?)b.RetryAtUtc)
            .SingleOrDefaultAsync(ct);

    public Task DeferVenueAsync(string venueId, DateTimeOffset retryAtUtc, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(async () =>
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO monitor_venue_budgets ("OwnerId", "VenueId", "RetryAtUtc")
                VALUES ({db.CurrentOwnerId}, {venueId}, {retryAtUtc})
                ON CONFLICT ("OwnerId", "VenueId") DO UPDATE
                SET "RetryAtUtc" = GREATEST(monitor_venue_budgets."RetryAtUtc", EXCLUDED."RetryAtUtc")
                """, ct);
            return true;
        }, ct);
    public Task<MonitorHeartbeat?> HeartbeatAsync(CancellationToken ct) =>
        db.Set<MonitorHeartbeat>().AsNoTracking().SingleOrDefaultAsync(ct);

    public Task RecordHeartbeatAsync(string workerId, DateTimeOffset now, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(async () =>
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO monitor_heartbeats ("OwnerId", "WorkerId", "HeartbeatAtUtc")
                VALUES ({db.CurrentOwnerId}, {workerId}, {now})
                ON CONFLICT ("OwnerId") DO UPDATE SET "WorkerId" = EXCLUDED."WorkerId",
                "HeartbeatAtUtc" = EXCLUDED."HeartbeatAtUtc"
                WHERE monitor_heartbeats."HeartbeatAtUtc" < EXCLUDED."HeartbeatAtUtc"
                """, ct);
            return true;
        }, ct);

    private IQueryable<PlayOrderLink> TerminalExits(Guid accountId) => db.OrderLinks.Where(l =>
        l.AccountId == accountId && l.State == OrderLinkState.Linked && l.Role != OrderLinkRole.Entry &&
        db.Plays.Any(p => p.Id == l.PlayId && p.InstrumentSource == InstrumentSource.Venue &&
            p.Origin == PlayOrigin.Planned && (p.Status == PlayStatus.Closed || p.Status == PlayStatus.Cancelled)));

    public async Task<bool> EligibleAsync(Guid accountId, CancellationToken ct) =>
        await db.Plays.AnyAsync(p => p.AccountId == accountId && p.InstrumentSource == InstrumentSource.Venue && p.ContractId != null &&
            p.Origin == PlayOrigin.Planned && (p.Status == PlayStatus.Planned || p.Status == PlayStatus.Paused || p.Status == PlayStatus.Open), ct)
        || await TerminalExits(accountId).AnyAsync(l => !Exits.Any(e => e.LinkId == l.Id && e.ResolvedAtUtc != null &&
            e.LinkRevisionAtUtc >= l.UpdatedAtUtc && e.OrderId == l.OrderId), ct);

    public async Task<IReadOnlyList<Guid>> DiscoverAsync(IReadOnlyCollection<string> venueIds, DateTimeOffset now, CancellationToken ct)
    {
        var ids = await db.Accounts.AsNoTracking().Where(a => a.IsEnabled && a.SourceId != null && venueIds.Contains(a.VenueId))
            .OrderBy(a => a.Id).Select(a => a.Id).Take(200).ToListAsync(ct);
        foreach (var id in ids)
        {
            await unitOfWork.ExecuteAsync(() => LockedAsync(id, async (_, row) =>
            {
                var capture = await CaptureAsync(id, ct);
                row.IntervalSeconds = (int)settings.Interval.TotalSeconds;
                var changedCredential = row.CredentialRevision != capture!.CredentialRevision;
                if (changedCredential && row.ManualState == "idle")
                {
                    row.CredentialRevision = capture.CredentialRevision;
                    if (row.State == "credential-error") { row.State = "idle"; row.Error = null; row.NextRunAtUtc = now; }
                }
                var eligible = await EligibleAsync(id, ct);
                if (eligible && row.State != "credential-error") row.NextRunAtUtc ??= now;
                else if (!eligible && row.ManualState == "idle") { row.State = "idle"; row.NextRunAtUtc = null; }
                return true;
            }, ct), ct);
        }
        return ids;
    }

    public Task<T> LockedAsync<T>(Guid id, Func<Account, MonitorAccount, Task<T>> action, CancellationToken ct) =>
        unitOfWork.ParticipateAsync(async () =>
        {
            var account = (await db.Accounts.FromSqlInterpolated($"""
                SELECT * FROM accounts WHERE "Id" = {id} AND "OwnerId" = {db.CurrentOwnerId} FOR UPDATE
                """).ToListAsync(ct)).SingleOrDefault() ?? throw new ProblemException(404, "Account not found.");
            await db.Entry(account).ReloadAsync(ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO monitor_accounts ("AccountId", "OwnerId", "State", "IntervalSeconds", "ManualState", "Trigger", "Generation", "ConsecutiveFailures", "HasHistoryGap")
                VALUES ({id}, {db.CurrentOwnerId}, 'idle', {(int)settings.Interval.TotalSeconds}, 'idle', 'monitor', 0, 0, false) ON CONFLICT ("AccountId") DO NOTHING
                """, ct);
            var row = (await db.Set<MonitorAccount>().FromSqlInterpolated($"""
                SELECT * FROM monitor_accounts WHERE "AccountId" = {id} AND "OwnerId" = {db.CurrentOwnerId} FOR UPDATE
                """).ToListAsync(ct)).Single();
            await db.Entry(row).ReloadAsync(ct);
            return await action(account, row);
        }, ct);

    public Task<IReadOnlyList<MonitorLease>> ClaimDueAsync(string worker, DateTimeOffset now, int limit, CancellationToken ct) =>
        unitOfWork.ExecuteAsync<IReadOnlyList<MonitorLease>>(async () =>
        {
            // Account then monitor is also the lock order used by API admission and guarded apply.
            var accounts = await db.Accounts.FromSqlInterpolated($"""
                SELECT a.* FROM accounts a JOIN monitor_accounts m ON a."Id" = m."AccountId"
                WHERE a."OwnerId" = {db.CurrentOwnerId} AND a."IsEnabled" AND a."SourceId" IS NOT NULL
                AND (m."NextRunAtUtc" <= {now} OR m."ManualState" <> 'idle')
                AND (m."LeaseUntilUtc" IS NULL OR m."LeaseUntilUtc" <= {now})
                AND (m."NextManualAllowedAtUtc" IS NULL OR m."NextManualAllowedAtUtc" <= {now})
                AND NOT EXISTS (SELECT 1 FROM monitor_venue_budgets b
                    WHERE b."OwnerId" = a."OwnerId" AND b."VenueId" = a."VenueId" AND b."RetryAtUtc" > {now})
                ORDER BY m."NextRunAtUtc", a."Id" LIMIT {Math.Clamp(limit, 1, 2)}
                FOR UPDATE OF a SKIP LOCKED
                """).ToListAsync(ct);
            var leases = new List<MonitorLease>();
            foreach (var account in accounts)
            {
                var lease = await LockedAsync<MonitorLease?>(account.Id, async (_, row) =>
                {
                    if (await VenueRetryAtAsync(account.VenueId, ct) > now) return null;
                    if (!await ReadCapacityAsync(now, ct)) return null;
                    if (row.ManualState == "idle")
                    {
                        if (!await EligibleAsync(account.Id, ct)) { row.NextRunAtUtc = null; row.State = "idle"; return null; }
                        row.Admit(Guid.CreateVersion7(), row.ConfirmationAtUtc <= now ? "confirmation" : "monitor", now);
                    }
                    return row.Claim(row.RequestId!.Value, worker, now, MonitorOptions.Lease)
                        ? new MonitorLease(row.AccountId, row.RequestId.Value, row.Generation, worker, row.Trigger) : null;
                }, ct);
                if (lease is not null) leases.Add(lease);
            }
            return leases;
        }, ct);

    public Task<MonitorLease?> ClaimAsync(Guid id, Guid requestId, string worker, DateTimeOffset now, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(() => LockedAsync<MonitorLease?>(id, async (account, row) =>
            account.IsEnabled && account.SourceId is not null && !(await VenueRetryAtAsync(account.VenueId, ct) > now) &&
            !(row.NextManualAllowedAtUtc > now) && await ReadCapacityAsync(now, ct) && row.Claim(requestId, worker, now, MonitorOptions.Lease)
                ? new MonitorLease(id, requestId, row.Generation, worker, row.Trigger) : null, ct), ct);

    public async Task<bool> ReadCapacityAsync(DateTimeOffset now, CancellationToken ct)
    {
        unitOfWork.RequireActive();
        var key = "vessel-monitor-budget:" + db.CurrentOwnerId;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        // ClaimDue can claim two rows in one transaction; flush the first lease before counting the next.
        await unitOfWork.SaveChangesAsync(ct);
        return await Rows.CountAsync(m => m.ManualState == "running" && m.LeaseUntilUtc > now, ct) < 2;
    }

    public Task<bool> RenewAsync(MonitorLease lease, DateTimeOffset now, CancellationToken ct) =>
        unitOfWork.ExecuteAsync(() => LockedAsync(lease.AccountId, (_, row) =>
        {
            if (!row.Owns(lease.Generation, lease.WorkerId, now)) return Task.FromResult(false);
            row.LeaseUntilUtc = now + MonitorOptions.Lease;
            return Task.FromResult(true);
        }, ct), ct);

    public async Task ResolveExitsAsync(Guid accountId, VenueOrderReadResult orders, CancellationToken ct)
    {
        if (!orders.OpenOrdersComplete) return;
        var links = await TerminalExits(accountId).ToListAsync(ct);
        var ended = await db.Plays.Where(p => p.AccountId == accountId &&
            (p.Status == PlayStatus.Closed || p.Status == PlayStatus.Cancelled))
            .ToDictionaryAsync(p => p.Id, p => p.EndedAtUtc, ct);
        var watches = await Exits.Where(e => e.AccountId == accountId).ToDictionaryAsync(e => e.LinkId, ct);
        foreach (var link in links)
        {
            if (!watches.TryGetValue(link.Id, out var watch))
            {
                watch = new() { LinkId = link.Id, OwnerId = link.OwnerId, AccountId = accountId, PlayId = link.PlayId, OrderId = link.OrderId };
                db.Add(watch);
            }
            // Closing during this import does not make an earlier order observation fresh after closure.
            if (orders.ObservedAtUtc <= link.UpdatedAtUtc || ended.GetValueOrDefault(link.PlayId) >= orders.ObservedAtUtc) continue;
            var current = orders.Orders.FirstOrDefault(o => o.OrderId == link.OrderId);
            if (watch.LinkRevisionAtUtc < link.UpdatedAtUtc || watch.OrderId != link.OrderId ||
                current?.Status == VenueOrderStatus.Open)
                watch.ResolvedAtUtc = null;
            watch.LinkRevisionAtUtc = link.UpdatedAtUtc;
            watch.OrderId = link.OrderId;
            if (current is null || current.Status is VenueOrderStatus.Filled or VenueOrderStatus.Canceled or VenueOrderStatus.Rejected)
                watch.ResolvedAtUtc = orders.ObservedAtUtc;
        }
    }
}
