using Microsoft.EntityFrameworkCore;

namespace Vessel.Identity;

public static class IdentityLimits
{
    public const int MaxWalletsPerUser = 20;

    // Callers hold the user's row lock.
    internal static async Task RequireWalletCapacityAsync(IdentityDbContext db, Guid userId, CancellationToken ct)
    {
        if (await db.Wallets.CountAsync(x => x.UserId == userId, ct) >= MaxWalletsPerUser)
            throw IdentityErrors.Error(409, "wallet-limit");
    }
}
