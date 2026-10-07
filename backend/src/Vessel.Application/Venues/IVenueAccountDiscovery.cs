namespace Vessel.Application.Venues;

public interface IVenueAccountDiscovery
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, CancellationToken cancellationToken);
}

public sealed record VenueAccountCandidate(string SourceId, string Name, string AccountType, string? AccountValueUsd = null);

public interface IVenueCredentialVerifier
{
    string VenueId { get; }
    Task<VerifiedVenueCredential> VerifyAsync(string sourceId, string token, CancellationToken cancellationToken);
}

public sealed record VerifiedVenueCredential(string Scope, DateTimeOffset ExpiresAt);
