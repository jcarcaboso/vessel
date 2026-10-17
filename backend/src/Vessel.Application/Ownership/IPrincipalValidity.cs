namespace Vessel.Application.Ownership;

/// <summary>
/// Whether the current request's principal may still receive data. Long-lived responses (event and market streams)
/// re-check it at least every keepalive and end when it turns false, so sign-out, revocation and suspension reach
/// streams that are already open.
/// </summary>
public interface IPrincipalValidity
{
    ValueTask<bool> StillValidAsync(CancellationToken cancellationToken);
}

/// <summary>Token mode: the configured token cannot be revoked while a stream is open.</summary>
public sealed class AlwaysValidPrincipal : IPrincipalValidity
{
    public ValueTask<bool> StillValidAsync(CancellationToken cancellationToken) => ValueTask.FromResult(true);
}
