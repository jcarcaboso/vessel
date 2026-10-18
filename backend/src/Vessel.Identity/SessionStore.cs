using Microsoft.EntityFrameworkCore;

namespace Vessel.Identity;

public sealed class SessionStore(Func<IDbContextFactory<IdentityDbContext>> factory, IdentitySettings settings, TimeProvider clock)
{
    public async Task<AuthenticatedSession> AuthenticateAsync(string? token, bool refresh, CancellationToken ct)
    {
        if (!IdentityTokens.Valid(token)) throw IdentityErrors.Error(401, "session-required");
        await using var db = await factory().CreateDbContextAsync(ct);
        var hash = IdentityTokens.Hash(token!);
        var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (session is null) throw IdentityErrors.Error(401, "session-revoked");
        var result = await CheckAsync(db, session, ct);
        if (refresh)
        {
            var now = clock.GetUtcNow();
            var until = now + settings.IdleLifetime(session.Remember);
            if (until > session.AbsoluteExpiresAt) until = session.AbsoluteExpiresAt;
            var changed = await db.Sessions.Where(x => x.Id == session.Id && x.LastSeenAt < now.AddMinutes(-5) &&
                    x.RevokedAt == null && x.IdleExpiresAt > now && x.AbsoluteExpiresAt > now)
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.LastSeenAt, now).SetProperty(x => x.IdleExpiresAt, until), ct);
            if (changed > 0) { session.LastSeenAt = now; session.IdleExpiresAt = until; }
        }
        return result;
    }

    public async Task<bool> StillValidAsync(Guid sessionId, CancellationToken ct)
    {
        try
        {
            await using var db = await factory().CreateDbContextAsync(ct);
            var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sessionId, ct);
            if (session is null) return false;
            _ = await CheckAsync(db, session, ct);
            return true;
        }
        catch (Exception) { return false; } // An outage terminates a stream rather than extending access.
    }

    private async Task<AuthenticatedSession> CheckAsync(IdentityDbContext db, IdentitySession session, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        if (session.RevokedAt is not null) throw IdentityErrors.Error(401, "session-revoked");
        if (session.IdleExpiresAt <= now || session.AbsoluteExpiresAt <= now) throw IdentityErrors.Error(401, "session-expired");
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == session.UserId, ct);
        if (user is null) throw IdentityErrors.Error(401, "session-revoked");
        if (user.Status != "active") throw IdentityErrors.Error(403, "user-suspended");
        var wallet = await db.Wallets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == session.WalletId && x.UserId == session.UserId, ct);
        if (wallet is null) throw IdentityErrors.Error(401, "session-revoked");
        return new(session, user, wallet);
    }
}
