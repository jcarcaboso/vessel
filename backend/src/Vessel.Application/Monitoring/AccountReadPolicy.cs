using Vessel.Application.Common;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Application.Monitoring;

/// <summary>Separate per-user discovery (10/minute) and verification (30/minute) budgets; neither leases a monitor slot.</summary>
public sealed class AccountReadPolicy(IServerStateStore server, UserReadLimits limits, TimeProvider time)
{
    public Task AdmitDiscoveryAsync(Guid owner, string venueId, CancellationToken ct) =>
        AdmitAsync(owner, venueId, "account-discovery", 10, ct);

    public Task AdmitVerificationAsync(Guid owner, string venueId, CancellationToken ct) =>
        AdmitAsync(owner, venueId, "credential-verification", 30, ct);

    private async Task AdmitAsync(Guid owner, string venueId, string budget, int limit, CancellationToken ct)
    {
        if (await server.VenueRetryAtAsync(venueId, ct) is { } deadline && deadline > time.GetUtcNow())
            throw UserReadLimits.Busy(Seconds(deadline));
        // No venue call is attempted behind a server deadline, so it spends neither user budget.
        limits.Admit(owner, budget, limit);
    }

    public async Task<ProblemException> LimitedAsync(string venueId, VenueRateLimitException error)
    {
        var now = time.GetUtcNow();
        await server.DeferVenueAsync(venueId, error.RetryAtUtc, now, CancellationToken.None);
        return UserReadLimits.Busy(Seconds(VenueRateLimitException.Clamp(error.RetryAtUtc, now)));
    }

    private int Seconds(DateTimeOffset deadline) => Math.Max(1, (int)Math.Ceiling((deadline - time.GetUtcNow()).TotalSeconds));
}
