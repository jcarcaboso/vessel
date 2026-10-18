using Vessel.Application.Ownership;

namespace Vessel.Identity;

/// <summary>A traffic-independent timer for a long-lived response. It never refreshes the session.</summary>
public sealed class PrincipalRevalidation : IAsyncDisposable
{
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
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15), clock);
        try
        {
            while (await timer.WaitForNextTickAsync(stop.Token))
                if (!await validity.StillValidAsync(stop.Token))
                {
                    await stop.CancelAsync();
                    return;
                }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception) { await stop.CancelAsync(); }
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        await revalidation;
        stop.Dispose();
    }
}
