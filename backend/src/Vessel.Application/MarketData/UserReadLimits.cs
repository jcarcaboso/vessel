using Vessel.Application.Common;

namespace Vessel.Application.MarketData;

/// <summary>Per-user sliding windows, shared by API requests in this process only.</summary>
public sealed class UserReadLimits(TimeProvider time)
{
    private const int MaxKeys = 8192;
    private readonly Dictionary<(Guid Owner, string Series), Queue<DateTimeOffset>> windows = [];

    public void Admit(Guid owner, string series, int limit)
    {
        var now = time.GetUtcNow();
        lock (windows)
        {
            foreach (var key in windows.Keys.ToArray())
            {
                var queue = windows[key];
                while (queue.TryPeek(out var at) && at <= now.AddMinutes(-1)) queue.Dequeue();
                if (queue.Count == 0) windows.Remove(key);
            }
            var keyForRead = (owner, series);
            if (!windows.TryGetValue(keyForRead, out var window))
            {
                // Fail closed rather than evicting another user's live budget.
                if (windows.Count >= MaxKeys) throw Busy(60);
                windows.Add(keyForRead, window = new());
            }
            if (window.Count >= limit) throw Busy(Math.Max(1, (int)Math.Ceiling((window.Peek().AddMinutes(1) - now).TotalSeconds)));
            window.Enqueue(now);
        }
    }

    public static ProblemException Busy(int seconds) =>
        new(429, "Too many venue reads. Wait before trying again.", code: "rate-limited", retryAfterSeconds: seconds);
}
