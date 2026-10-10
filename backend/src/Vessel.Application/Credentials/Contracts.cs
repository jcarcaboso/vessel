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
    /// Metadata-only check for status displays and polling: no account lock and no decryption.
    /// A later read can still fail, so callers that need the token must use <see cref="ReadAsync"/>.
    /// </summary>
    async Task<bool> IsUsableAsync(Account account, CancellationToken cancellationToken) =>
        await ReadAsync(account.Id, cancellationToken) is not null;

    /// <summary>
    /// Records that the venue explicitly refused the stored token, so it is no longer read or reported as usable
    /// until it is verified again. Not for timeouts or outages.
    /// </summary>
    Task MarkRefusedAsync(Guid accountId, CancellationToken cancellationToken);
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
