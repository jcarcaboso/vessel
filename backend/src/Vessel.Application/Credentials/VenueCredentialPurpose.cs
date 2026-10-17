namespace Vessel.Application.Credentials;

/// <summary>
/// Credential purposes stored with each sealed credential. The purpose is part of the AES-GCM associated data
/// (<c>vessel:credential:v1|{ownerId}|{accountId}|{purpose}</c>), so its text must never change: a different string
/// would make every existing envelope unreadable.
/// </summary>
public static class VenueCredentialPurpose
{
    /// <summary>The read-only token purpose for a venue: <c>{venueId}-read-token</c>, e.g. <c>lighter-read-token</c>.</summary>
    public static string ReadToken(string venueId) => venueId + "-read-token";
}
