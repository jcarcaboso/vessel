using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Channels;
using Vessel.Application.MarketData;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Tests;

/// <summary>Deterministic clock: timers fire only when the test advances time.</summary>
internal sealed class ManualTime(DateTimeOffset start) : TimeProvider
{
    private readonly object sync = new();
    private readonly List<ManualTimer> timers = [];
    private readonly DateTimeOffset origin = start;
    private DateTimeOffset now = start;

    public override DateTimeOffset GetUtcNow() { lock (sync) return now; }
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => (GetUtcNow() - origin).Ticks;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new ManualTimer(this, callback, state);
        timer.Change(dueTime, period);
        return timer;
    }

    public int TimerCount { get { lock (sync) return timers.Count; } }

    public void Advance(TimeSpan delta)
    {
        DateTimeOffset target;
        lock (sync) target = now + delta;
        while (true)
        {
            ManualTimer? next;
            lock (sync)
            {
                next = timers.Where(t => t.Due <= target).MinBy(t => t.Due);
                if (next is null) { now = target; return; }
                now = next.Due;
                if (next.Period > TimeSpan.Zero) next.Due += next.Period;
                else timers.Remove(next);
            }
            next.Fire();
        }
    }

    private sealed class ManualTimer(ManualTime owner, TimerCallback callback, object? state) : ITimer
    {
        public DateTimeOffset Due;
        public TimeSpan Period;

        public void Fire() => callback(state);

        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (owner.sync)
            {
                owner.timers.Remove(this);
                if (dueTime == Timeout.InfiniteTimeSpan) return true;
                Due = owner.now + dueTime;
                Period = period == Timeout.InfiniteTimeSpan ? TimeSpan.Zero : period;
                owner.timers.Add(this);
            }
            return true;
        }

        public void Dispose() { lock (owner.sync) owner.timers.Remove(this); }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}

internal sealed class FakeSocketFactory : IWebSocketTransportFactory
{
    private readonly ConcurrentQueue<FakeSocket> sockets = new();
    public volatile bool FailConnect;
    public IReadOnlyList<FakeSocket> Sockets => [.. sockets];
    public FakeSocket Latest => sockets.Last();

    public IWebSocketTransport Create()
    {
        var socket = new FakeSocket(FailConnect);
        sockets.Enqueue(socket);
        return socket;
    }
}

internal sealed class FakeSocket(bool failConnect) : IWebSocketTransport
{
    private readonly Channel<object?> inbound = Channel.CreateUnbounded<object?>();
    private readonly ConcurrentQueue<string> sent = new();
    private int reads;
    public volatile bool Connected, Closed, Disposed;

    public IReadOnlyList<string> Sent => [.. sent];
    /// <summary>Number of receive calls; the loop is sequential, so n+1 calls means n messages were handled.</summary>
    public int Reads => Volatile.Read(ref reads);

    public void Push(string json) => inbound.Writer.TryWrite(Encoding.UTF8.GetBytes(json));
    public void Fail() => inbound.Writer.TryWrite(new WebSocketException("dropped"));
    public void PeerClose() => inbound.Writer.TryWrite(null);

    public Task ConnectAsync(Uri uri, CancellationToken cancellationToken)
    {
        Assert.Equal("wss://api.hyperliquid.xyz/ws", uri.ToString());
        if (failConnect) throw new WebSocketException("refused");
        Connected = true;
        return Task.CompletedTask;
    }

    public Task SendTextAsync(string message, CancellationToken cancellationToken)
    {
        sent.Enqueue(message);
        return Task.CompletedTask;
    }

    public async Task<byte[]?> ReceiveAsync(int maxBytes, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref reads);
        var item = await inbound.Reader.ReadAsync(cancellationToken);
        return item switch
        {
            Exception ex => throw ex,
            byte[] bytes => bytes,
            _ => null
        };
    }

    public Task CloseAsync(CancellationToken cancellationToken) { Closed = true; return Task.CompletedTask; }
    public ValueTask DisposeAsync() { Disposed = true; return ValueTask.CompletedTask; }
}

/// <summary>Application-level fake port: tests write events into each subscription.</summary>
internal sealed class FakeMarketStream : IMarketStream
{
    public string VenueId { get; init; } = "hyperliquid";
    public Exception? Failure { get; set; }
    public ConcurrentQueue<FakeSubscription> Subscriptions { get; } = new();
    public FakeSubscription Latest => Subscriptions.Last();

    public IMarketStreamSubscription Subscribe(string contractId, string interval)
    {
        if (Failure is not null) throw Failure;
        var subscription = new FakeSubscription(contractId, interval);
        Subscriptions.Enqueue(subscription);
        return subscription;
    }
}

internal sealed class FakeSubscription(string contractId, string interval) : IMarketStreamSubscription
{
    private readonly Channel<MarketStreamEvent> events = Channel.CreateUnbounded<MarketStreamEvent>();
    public string ContractId { get; } = contractId;
    public string Interval { get; } = interval;
    public volatile bool Disposed;

    public void Write(MarketStreamEvent value) => events.Writer.TryWrite(value);
    public void Complete() => events.Writer.TryComplete();

    public async IAsyncEnumerable<MarketStreamEvent> ReadAllAsync([EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await foreach (var value in events.Reader.ReadAllAsync(cancellationToken))
            yield return value;
    }

    public void Dispose() { Disposed = true; events.Writer.TryComplete(); }
}

internal static class Eventually
{
    public static async Task True(Func<bool> condition, string because, Action? step = null)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!condition())
        {
            Assert.True(DateTime.UtcNow < deadline, because);
            step?.Invoke();
            await Task.Delay(5);
        }
    }

    public static async Task<T> Next<T>(IAsyncEnumerator<T> enumerator)
    {
        Assert.True(await enumerator.MoveNextAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10)), "The stream ended early.");
        return enumerator.Current;
    }
}
