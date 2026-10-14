using Microsoft.EntityFrameworkCore;
using Vessel.Application.Plays;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class PlayStore(VesselDbContext db) : IPlayStore
{
    public Task<List<Play>> ListAsync(CancellationToken ct) =>
        db.Plays.OrderByDescending(x => x.UpdatedAtUtc).ThenBy(x => x.Id).AsNoTracking().ToListAsync(ct);
    public Task<Play?> FindAsync(Guid id, CancellationToken ct) => db.Plays.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => db.Accounts.SingleOrDefaultAsync(x => x.Id == id, ct);
    public Task<List<PlayPlanRevision>> RevisionsAsync(Guid playId, CancellationToken ct) =>
        db.PlanRevisions.Where(x => x.PlayId == playId).OrderBy(x => x.Number).AsNoTracking().ToListAsync(ct);
    public Task<List<PlayStatusChange>> StatusChangesAsync(Guid playId, CancellationToken ct) =>
        db.StatusChanges.Where(x => x.PlayId == playId).OrderBy(x => x.OccurredAtUtc).ThenBy(x => x.Id).AsNoTracking().ToListAsync(ct);
    public Task<List<PlayReviewRevision>> ReviewsAsync(Guid playId, CancellationToken ct) =>
        db.ReviewRevisions.Where(x => x.PlayId == playId).OrderBy(x => x.Number).AsNoTracking().ToListAsync(ct);
    public async Task<IReadOnlySet<string>> FilledEntryIdsAsync(Guid playId, CancellationToken ct)
    {
        // Linked unfilled entry orders can fill later. Keep their referenced plan too, not only already-filled rows.
        var ids = await db.OrderLinks.Where(l => l.PlayId == playId && l.State == OrderLinkState.Linked && l.Role == OrderLinkRole.Entry)
            .Select(l => l.EntryId!).Distinct().ToListAsync(ct);
        ids.AddRange(await db.ManualExecutions.Where(r => r.PlayId == playId && r.Role == "entry").Select(r => r.EntryId!).Distinct().ToListAsync(ct));
        return ids.ToHashSet(StringComparer.Ordinal);
    }
    public void Add(Play play) => db.Plays.Add(play);
    public Task<List<PlayOrderLink>> LinkedPlanReferencesAsync(Guid playId, CancellationToken ct) =>
        db.OrderLinks.Where(l => l.PlayId == playId && l.State == OrderLinkState.Linked).AsNoTracking().ToListAsync(ct);
    public void Add(PlayPlanRevision revision) => db.PlanRevisions.Add(revision);
    public void Add(PlayStatusChange change) => db.StatusChanges.Add(change);
    public void Add(PlayReviewRevision revision) => db.ReviewRevisions.Add(revision);

    public async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            throw new WorkspaceException(409, "This Play changed elsewhere. Reload it before saving again.");
        }
    }

    public async Task<T> WithPlayLockAsync<T>(Guid id, Func<Task<T>> action, CancellationToken ct, Guid? destinationAccountId = null)
    {
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var accountId = await db.Plays.Where(p => p.Id == id).Select(p => (Guid?)p.AccountId).SingleOrDefaultAsync(ct)
            ?? throw new WorkspaceException(404, "Play not found.");
        if (destinationAccountId is { } destination && destination != accountId)
        {
            // ponytail: moves serialize per owner; use ordered account locks if move throughput requires it.
            // Reuse the management key before either account row to avoid destination FK key-share deadlocks.
            var key = "vessel-management:" + db.CurrentOwnerId;
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
            await new WorkspaceStore(db).WithAccountLockAsync(destination, _ => Task.FromResult(true), ct);
        }
        // Lock order is account row -> execution advisory -> Play row everywhere.
        await new ExecutionStore(db).WithAccountLockAsync(accountId, () => Task.FromResult(true), ct);
        // The same row lock ExecutionStore.ActivePlaysAsync takes; evidence and history inserts only need a key share.
        var plays = await db.Plays.FromSqlInterpolated(
            $"SELECT * FROM plays WHERE \"Id\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} FOR NO KEY UPDATE").ToListAsync(ct);
        // A scoped context could already track this Play before waiting on the lock.
        foreach (var play in plays) await db.Entry(play).ReloadAsync(ct);
        if (plays.SingleOrDefault()?.AccountId != accountId)
            throw new WorkspaceException(409, "The Play moved to another account. Reload before editing.");
        var result = await action();
        if (transaction is not null) await transaction.CommitAsync(ct);
        return result;
    }

    public async Task<IReadOnlyList<string>> DeleteAsync(Play play, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var evidence = await db.Evidence.Where(x => x.PlayId == play.Id).ToListAsync(ct);
        db.Evidence.RemoveRange(evidence);
        db.PlanRevisions.RemoveRange(await db.PlanRevisions.Where(x => x.PlayId == play.Id).ToListAsync(ct));
        db.StatusChanges.RemoveRange(await db.StatusChanges.Where(x => x.PlayId == play.Id).ToListAsync(ct));
        db.OrderLinks.RemoveRange(await db.OrderLinks.Where(x => x.PlayId == play.Id).ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        db.Plays.Remove(play);
        await SaveAsync(ct);
        await transaction.CommitAsync(ct);
        return evidence.Select(x => x.ObjectKey).ToList();
    }
}
