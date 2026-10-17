using Vessel.Application.Common;
using Vessel.Application.MarketData;
using Vessel.Application.Venues;

namespace Vessel.Application.Monitoring;

/// <summary>Discovery and credential verification share ten attempts per user per minute; neither leases a monitor slot.</summary>
public sealed class AccountReadPolicy(IServerStateStore server, UserReadLimits limits, TimeProvider time)
{
    public async Task AdmitAsync(Guid owner, string venueId, CancellationToken ct)
    {
        limits.Admit(owner, "account-reads", 10);
        if (await server.VenueRetryAtAsync(venueId, ct) is { } deadline && deadline > time.GetUtcNow())
            throw UserReadLimits.Busy(Seconds(deadline));
    }

    public async Task<ProblemException> LimitedAsync(string venueId, VenueRateLimitException error)
    {
        var now = time.GetUtcNow();
        await server.DeferVenueAsync(venueId, error.RetryAtUtc, now, CancellationToken.None);
        return UserReadLimits.Busy(Seconds(VenueRateLimitException.Clamp(error.RetryAtUtc, now)));
    }

    private int Seconds(DateTimeOffset deadline) => Math.Max(1, (int)Math.Ceiling((deadline - time.GetUtcNow()).TotalSeconds));
}
