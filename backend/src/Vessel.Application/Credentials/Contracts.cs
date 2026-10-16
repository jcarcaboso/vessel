using System.Text.Json.Serialization;
using Vessel.Domain.Accounts;
using Vessel.Domain.Credentials;

namespace Vessel.Application.Credentials;

public interface ICredentialVault
{
    bool IsConfigured { get; }
    /// <summary>Whether a sealed credential's key is still in the ring, without opening it.</summary>
    bool HasKey(string keyId) => IsConfigured;
    SealedCredential Seal(Guid ownerId, Guid accountId, string purpose, string plaintext);
    string Open(Guid ownerId, Guid accountId, string purpose, SealedCredential credential);
}

public sealed class CredentialStorageException() : Exception("Credential storage is unavailable. Re-enter the read-only token after configuring storage.");

public interface IAccountCredentialReader
{
    Task<string?> ReadAsync(Guid accountId, CancellationToken cancellationToken);
    /// <summary>
    /// The token with the revision of the sealed envelope it came from, so a later refusal can only mark that envelope.
    /// Every implementation must report the stored revision; an empty or stale revision never marks a refusal.
    /// </summary>
    Task<CredentialAttempt?> ReadAttemptAsync(Guid accountId, CancellationToken cancellationToken);

    /// <summary>
    /// Metadata-only check for status displays and polling: no account lock and no decryption.
    /// A later read can still fail, so callers that need the token must use <see cref="ReadAsync"/>.
    /// </summary>
    async Task<bool> IsUsableAsync(Account account, CancellationToken cancellationToken) =>
        await ReadAsync(account.Id, cancellationToken) is not null;

    /// <summary>
    /// Records that the venue explicitly refused the stored token, so it is no longer read or reported as usable
    /// until it is verified again. Not for timeouts or outages.
    /// </summary>
    Task MarkRefusedAsync(Guid accountId, string attemptedRevision, CancellationToken cancellationToken);
}

// Not a record: generated ToString must never print the token. Revision identifies the sealed
// envelope, so re-verifying the same plaintext also protects it from an older in-flight refusal.
public sealed class CredentialAttempt(string token, string revision)
{
    public string Token { get; } = token;
    public string Revision { get; } = revision;
    public static string RevisionOf(AccountCredential credential) => Convert.ToHexString(
        global::System.Security.Cryptography.SHA256.HashData(credential.Ciphertext.Concat(credential.Tag).Concat(credential.Nonce)
            .Concat(global::System.Text.Encoding.UTF8.GetBytes(
                $"{credential.KeyId}|{credential.Purpose}|{credential.LastVerifiedAt:O}|{credential.ExpiresAt:O}")).ToArray()));
}

public interface IAccountCredentialStore
{
    Task<AccountCredential?> FindAsync(Guid accountId, string purpose, CancellationToken ct);
    Task SaveAsync(AccountCredential credential, CancellationToken ct);
    Task DeleteAsync(Guid accountId, string purpose, CancellationToken ct);
}

public sealed class SaveAccountCredentialRequest
{
    [JsonRequired]
    public string Token { get; init; } = null!;
}

public sealed record CredentialMetadata(string Scope, DateTimeOffset ExpiresAt, DateTimeOffset LastVerifiedAt, string Status);
public sealed record AccountCredentialDto(bool StorageConfigured, CredentialMetadata? Credential);
