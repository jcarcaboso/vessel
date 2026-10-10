using System.Collections.Concurrent;
using System.Net;

namespace Vessel.Infrastructure.Auth;

/// <summary>
/// Tracks wrong tokens per client address. After <see cref="MaxFailures"/> within <see cref="Window"/>, further
/// wrong tokens from that address are answered with 429 until the window ends. The configured token is a
/// generated 32+ character secret, so this slows and flags guessing rather than being the only defence.
/// </summary>
public sealed class AuthFailureLimiter(TimeProvider time)
{
    public const int MaxFailures = 20;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);
    private const int MaxTracked = 10_000;
    private readonly ConcurrentDictionary<string, Entry> entries = new(StringComparer.Ordinal);

    private sealed record Entry(DateTimeOffset Start, int Failures);

    /// <summary>Remaining lockout, or null when the address may try again.</summary>
    public TimeSpan? Blocked(IPAddress? address)
    {
        if (!entries.TryGetValue(Key(address), out var entry)) return null;
        var remaining = entry.Start + Window - time.GetUtcNow();
        return entry.Failures >= MaxFailures && remaining > TimeSpan.Zero ? remaining : null;
    }

    public void RecordFailure(IPAddress? address)
    {
        var now = time.GetUtcNow();
        if (entries.Count >= MaxTracked) Prune(now);
        entries.AddOrUpdate(Key(address), _ => new(now, 1),
            (_, entry) => entry.Start + Window <= now ? new(now, 1) : entry with { Failures = entry.Failures + 1 });
    }

    private void Prune(DateTimeOffset now)
    {
        foreach (var (key, entry) in entries)
            if (entry.Start + Window <= now) entries.TryRemove(key, out _);
        // Still full of live entries: forget the oldest windows rather than grow without bound.
        if (entries.Count >= MaxTracked)
            foreach (var key in entries.OrderBy(e => e.Value.Start).Take(MaxTracked / 10).Select(e => e.Key).ToList())
                entries.TryRemove(key, out _);
    }

    private static string Key(IPAddress? address) => address?.MapToIPv6().ToString() ?? "local";
}
