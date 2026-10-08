namespace Vessel.Application.Venues;

public interface IVenueAccountDiscovery
{
    string VenueId { get; }
    Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, CancellationToken cancellationToken);
    Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, string token, CancellationToken cancellationToken) =>
        throw new VenueReadException("Authenticated account discovery is unavailable.");
}

public sealed record VenueAccountCandidate(string SourceId, string Name, string AccountType, string? AccountValueUsd = null,
    string? CollateralUsd = null, string? AvailableBalanceUsd = null);

public interface IVenueCredentialVerifier
{
    string VenueId { get; }
    Task<VerifiedVenueCredential> VerifyAsync(string sourceId, string token, CancellationToken cancellationToken);
}

public sealed record VerifiedVenueCredential(string Scope, DateTimeOffset ExpiresAt);
