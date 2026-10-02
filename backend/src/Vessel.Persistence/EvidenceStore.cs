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
    public async Task AddAsync(PlayEvidence evidence, CancellationToken ct) { db.Evidence.Add(evidence); await db.SaveChangesAsync(ct); }
    public async Task RemoveAsync(PlayEvidence evidence, CancellationToken ct) { db.Evidence.Remove(evidence); await db.SaveChangesAsync(ct); }
    public async Task SaveAsync(CancellationToken ct) => await db.SaveChangesAsync(ct);
}
