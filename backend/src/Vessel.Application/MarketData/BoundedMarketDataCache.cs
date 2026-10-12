namespace Vessel.Application.MarketData;

/// <summary>Public venue data only: bounded LRU storage and cancellation-independent single-flight loads.</summary>
public sealed class BoundedMarketDataCache<T>(TimeProvider time, int maxEntries, int maxItems, Func<T, int> weight)
{
    public static readonly TimeSpan ReadDeadline = TimeSpan.FromSeconds(30);
    private sealed record Entry(DateTimeOffset Expires, T Value, int Weight);
    private readonly object gate = new();
    private readonly Dictionary<string, LinkedListNode<(string Key, Entry Entry)>> entries = new(StringComparer.Ordinal);
    private readonly LinkedList<(string Key, Entry Entry)> lru = new();
    private readonly Dictionary<string, Task<T>> flights = new(StringComparer.Ordinal);
    private int items;

    public T? Get(string key)
    {
        lock (gate) return TryGet(key, out var value) ? value : default;
    }

    private bool TryGet(string key, out T value)
    {
        if (entries.TryGetValue(key, out var node))
        {
            if (node.Value.Entry.Expires > time.GetUtcNow())
            {
                lru.Remove(node);
                lru.AddLast(node);
                value = node.Value.Entry.Value;
                return true;
            }
            Remove(node);
        }
        value = default!;
        return false;
    }

    public void Set(string key, T value, TimeSpan lifetime)
    {
        lock (gate)
        {
            if (entries.TryGetValue(key, out var previous)) Remove(previous);
            var size = weight(value);
            if (size > maxItems) return;
            while (entries.Count >= maxEntries || items + size > maxItems) Remove(lru.First!);
            var node = lru.AddLast((key, new Entry(time.GetUtcNow() + lifetime, value, size)));
            entries.Add(key, node);
            items += size;
        }
    }

    private void Remove(LinkedListNode<(string Key, Entry Entry)> node)
    {
        entries.Remove(node.Value.Key);
        lru.Remove(node);
        items -= node.Value.Entry.Weight;
    }

    public async Task<T> GetAsync(string key, Func<CancellationToken, Task<T>> load, Func<T, TimeSpan> lifetime,
        CancellationToken ct, bool refresh = false)
    {
        ct.ThrowIfCancellationRequested();
        Task<T> task;
        TaskCompletionSource<T>? source = null;
        lock (gate)
        {
            // An in-flight refresh supersedes the old cached value for concurrent readers too.
            if (!flights.TryGetValue(key, out task!))
            {
                if (!refresh && TryGet(key, out var hit)) return hit;
                source = new(TaskCreationOptions.RunContinuationsAsynchronously);
                task = source.Task;
                flights.Add(key, task);
            }
        }
        if (source is not null) _ = LoadAsync(key, load, lifetime, source);
        ct.ThrowIfCancellationRequested();
        T result;
        try { result = await task.WaitAsync(ct); }
        catch (Exception) when (ct.IsCancellationRequested) { throw new OperationCanceledException(ct); }
        ct.ThrowIfCancellationRequested();
        return result;
    }

    private async Task LoadAsync(string key, Func<CancellationToken, Task<T>> load, Func<T, TimeSpan> lifetime,
        TaskCompletionSource<T> source)
    {
        // A real-time independent deadline also bounds adapters that ignore cancellation.
        using var deadline = new CancellationTokenSource(ReadDeadline);
        try
        {
            var value = await load(deadline.Token).WaitAsync(deadline.Token);
            deadline.Token.ThrowIfCancellationRequested();
            lock (gate)
            {
                Set(key, value, lifetime(value));
                flights.Remove(key);
                source.SetResult(value);
            }
        }
        catch (Exception ex)
        {
            lock (gate)
            {
                flights.Remove(key);
                source.SetException(ex);
                // Observe failures even when every waiter has cancelled.
                _ = source.Task.Exception;
            }
        }
    }
}
