using Vessel.Application.Common;

namespace Vessel.Application.MarketData;

/// <summary>Per-user sliding windows, shared by API requests in this process only.</summary>
public sealed class UserReadLimits(TimeProvider time)
{
    private const int MaxKeys = 8192, MaxUserKeys = 256, SweepBatch = 16;
    private readonly Dictionary<(Guid Owner, string? Series), Window> windows = [];
    private readonly Dictionary<Guid, HashSet<Window>> users = [];
    private readonly LinkedList<Window> sweep = [];

    public void Admit(Guid owner, string series, int limit)
    {
        ArgumentException.ThrowIfNullOrEmpty(series);
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        var now = time.GetUtcNow();
        lock (windows)
        {
            Sweep(SweepBatch, now);
            // A null series is a user's temporary block after fair-share eviction, not a reset budget.
            if (windows.TryGetValue((owner, null), out var blocked) && !Expire(blocked, now))
                throw Busy(Seconds(blocked, now));
            var key = (owner, series);
            if (windows.TryGetValue(key, out var window) && Expire(window, now)) window = null;
            if (window is null)
            {
                if (users.TryGetValue(owner, out var keys) && keys.Count >= MaxUserKeys)
                {
                    // At most 256 keys, even when this user's expired keys are later in the sweep rotation.
                    foreach (var entry in keys.ToArray()) Expire(entry, now);
                    if (users.TryGetValue(owner, out keys) && keys.Count >= MaxUserKeys) throw Busy(60);
                }
                if (windows.Count >= MaxKeys) Sweep(sweep.Count, now);
                if (windows.Count >= MaxKeys)
                {
                    var count = users.GetValueOrDefault(owner)?.Count ?? 0;
                    var fairShare = MaxKeys / (users.Count + (count == 0 ? 1 : 0));
                    if (count + 1 > fairShare) throw Busy(60);
                    // Only an over-share requester is refused. Otherwise consolidate the largest user's
                    // live keys into a one-minute block: free slots without letting them reset cooldowns.
                    // A single user is also bounded to 256 keys and cannot exhaust the global backstop.
                    var largest = users.MaxBy(user => user.Value.Count);
                    foreach (var entry in largest.Value.ToArray()) Remove(entry);
                    Add((largest.Key, null), now);
                }
                window = Add(key, now);
            }
            else
            {
                if (window.Reads.Count >= limit) throw Busy(Seconds(window, now));
                window.Reads.Enqueue(now);
            }
        }
    }

    private Window Add((Guid Owner, string? Series) key, DateTimeOffset now)
    {
        var window = new Window(key);
        window.Reads.Enqueue(now);
        windows.Add(key, window);
        if (!users.TryGetValue(key.Owner, out var keys)) users.Add(key.Owner, keys = []);
        keys.Add(window);
        window.Node = sweep.AddLast(window);
        return window;
    }

    private void Sweep(int limit, DateTimeOffset now)
    {
        var count = Math.Min(limit, sweep.Count);
        for (var index = 0; index < count; index++)
        {
            var node = sweep.First!;
            if (Expire(node.Value, now)) continue;
            sweep.RemoveFirst();
            sweep.AddLast(node);
        }
    }

    private bool Expire(Window window, DateTimeOffset now)
    {
        while (window.Reads.TryPeek(out var at) && at <= now.AddMinutes(-1)) window.Reads.Dequeue();
        if (window.Reads.Count != 0) return false;
        Remove(window);
        return true;
    }

    private void Remove(Window window)
    {
        windows.Remove(window.Key);
        sweep.Remove(window.Node);
        var keys = users[window.Key.Owner];
        keys.Remove(window);
        if (keys.Count == 0) users.Remove(window.Key.Owner);
    }

    private static int Seconds(Window window, DateTimeOffset now) =>
        Math.Max(1, (int)Math.Ceiling((window.Reads.Peek().AddMinutes(1) - now).TotalSeconds));

    private sealed class Window((Guid Owner, string? Series) key)
    {
        public (Guid Owner, string? Series) Key { get; } = key;
        public Queue<DateTimeOffset> Reads { get; } = [];
        public LinkedListNode<Window> Node { get; set; } = null!;
    }

    public static ProblemException Busy(int seconds) =>
        new(429, "Too many venue reads. Wait before trying again.", code: "rate-limited", retryAfterSeconds: seconds);
}
