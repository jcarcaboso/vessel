using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Domain.Credentials;

namespace Vessel.Persistence;

public sealed class AccountCredentialStore(VesselDbContext db) : IAccountCredentialStore
{
    public Task<AccountCredential?> FindAsync(Guid accountId, string purpose, CancellationToken ct) =>
        db.AccountCredentials.AsNoTracking().SingleOrDefaultAsync(c => c.AccountId == accountId && c.Purpose == purpose, ct);

    public async Task SaveAsync(AccountCredential credential, CancellationToken ct)
    {
        // The application holds the account row lock for this read/replace transaction.
        var existing = await db.AccountCredentials.SingleOrDefaultAsync(c => c.AccountId == credential.AccountId && c.Purpose == credential.Purpose, ct);
        if (existing is null) db.AccountCredentials.Add(credential);
        else db.Entry(existing).CurrentValues.SetValues(credential);
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid accountId, string purpose, CancellationToken ct)
    {
        await db.AccountCredentials.Where(c => c.AccountId == accountId && c.Purpose == purpose).ExecuteDeleteAsync(ct);
        foreach (var entry in db.ChangeTracker.Entries<AccountCredential>().Where(e =>
            e.Entity.OwnerId == db.CurrentOwnerId && e.Entity.AccountId == accountId && e.Entity.Purpose == purpose).ToList())
            entry.State = EntityState.Detached;
    }
}
