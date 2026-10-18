using Vessel.Application.Ownership;

namespace Vessel.Identity;

/// <summary>
/// A traffic-independent timer for a long-lived response. It never refreshes the session. Each check has its own
/// deadline, enforced on the injected clock without relying on the check honouring cancellation, so a stalled identity
/// read (a lock, pool exhaustion, a partition) ends the response instead of leaving the last answer valid.
/// </summary>
public sealed class PrincipalRevalidation : IAsyncDisposable
{
    public static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(15);
    public static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(10);

    private readonly CancellationTokenSource stop;
    private readonly Task revalidation;
    public CancellationToken Token => stop.Token;

    public PrincipalRevalidation(IPrincipalValidity validity, TimeProvider clock, CancellationToken aborted)
    {
        stop = CancellationTokenSource.CreateLinkedTokenSource(aborted);
        revalidation = RunAsync(validity, clock);
    }

    private async Task RunAsync(IPrincipalValidity validity, TimeProvider clock)
    {
        using var timer = new PeriodicTimer(CheckInterval, clock);
        try
        {
            while (await timer.WaitForNextTickAsync(stop.Token))
            {
                using var deadline = new CancellationTokenSource(CheckTimeout, clock);
                using var check = CancellationTokenSource.CreateLinkedTokenSource(stop.Token, deadline.Token);
                // WaitAsync stops waiting at the deadline even if the check ignores its token; the token still asks
                // the database command to cancel.
                if (!await validity.StillValidAsync(check.Token).AsTask().WaitAsync(check.Token))
                {
                    await stop.CancelAsync();
                    return;
                }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception) { await stop.CancelAsync(); } // Failures and timeouts close the stream.
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        await revalidation;
        stop.Dispose();
    }
}
