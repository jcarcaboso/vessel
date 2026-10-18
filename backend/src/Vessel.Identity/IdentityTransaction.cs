using Microsoft.EntityFrameworkCore;

namespace Vessel.Identity;

public sealed class IdentityTransaction(IDbContextFactory<IdentityDbContext> factory)
{
    public async Task<T> RunAsync<T>(Func<IdentityDbContext, Task<T>> action, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // ponytail: identity writes serialize per schema; replace with narrower locks if sign-in volume warrants it.
        // A2's per-user locks may be taken inside this lock, never in the reverse order.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({db.Schema.Name + ":identity-write"}, 0))", ct);
        var result = await action(db);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return result;
    }

    public static async Task<IdentityUser?> LockUserAsync(IdentityDbContext db, Guid id, CancellationToken ct)
    {
        // The identifier is validated by IdentitySchema; the ID stays a parameter.
        var sql = $"SELECT * FROM \"{db.Schema.Name}\".users WHERE id = {{0}} FOR UPDATE";
        return await db.Users.FromSqlRaw(sql, id).SingleOrDefaultAsync(ct);
    }
}
