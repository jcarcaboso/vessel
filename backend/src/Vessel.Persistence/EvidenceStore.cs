using Microsoft.EntityFrameworkCore;
using Vessel.Application.Evidence;
using Vessel.Domain.Evidence;
using Vessel.Domain.Plays;

namespace Vessel.Persistence;

public sealed class EvidenceStore(VesselDbContext db) : IEvidenceMetadataStore
{
    public Task<Play?> PlayAsync(Guid playId, CancellationToken ct) => db.Plays.SingleOrDefaultAsync(x => x.Id == playId, ct);
    public Task<List<PlayEvidence>> ListAsync(Guid playId, CancellationToken ct) => db.Evidence.Where(x => x.PlayId == playId)
        .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id).AsNoTracking().ToListAsync(ct);
    public Task<int> CountAsync(Guid playId, CancellationToken ct) => db.Evidence.CountAsync(x => x.PlayId == playId, ct);
    public Task<PlayEvidence?> FindAsync(Guid id, CancellationToken ct) => db.Evidence.SingleOrDefaultAsync(x => x.Id == id, ct);
    public async Task<bool> AddAsync(PlayEvidence evidence, int maxPerPlay, CancellationToken ct)
    {
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        // Serializes uploads to one Play across API processes so the limit holds under concurrency.
        var key = "vessel-evidence:" + evidence.PlayId;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        if (await db.Evidence.CountAsync(x => x.PlayId == evidence.PlayId, ct) >= maxPerPlay) return false;
        db.Evidence.Add(evidence);
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return true;
    }
    public async Task RemoveAsync(PlayEvidence evidence, CancellationToken ct) { db.Evidence.Remove(evidence); await db.SaveChangesAsync(ct); }
    public async Task SaveAsync(CancellationToken ct) => await db.SaveChangesAsync(ct);
}
