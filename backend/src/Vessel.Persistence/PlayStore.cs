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
    public async Task<IReadOnlySet<string>> FilledEntryIdsAsync(Guid playId, CancellationToken ct)
    {
        var ids = await db.OrderLinks.Where(l => l.PlayId == playId && l.State == OrderLinkState.Linked && l.Role == OrderLinkRole.Entry &&
                db.Fills.Any(f => f.AccountId == l.AccountId && f.OrderId == l.OrderId))
            .Select(l => l.EntryId!).Distinct().ToListAsync(ct);
        return ids.ToHashSet(StringComparer.Ordinal);
    }
    public void Add(Play play) => db.Plays.Add(play);
    public void Add(PlayPlanRevision revision) => db.PlanRevisions.Add(revision);
    public void Add(PlayStatusChange change) => db.StatusChanges.Add(change);

    public async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            throw new WorkspaceException(409, "This Play changed elsewhere. Reload it before saving again.");
        }
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
