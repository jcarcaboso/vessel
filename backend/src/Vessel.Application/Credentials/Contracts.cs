using System.Text.Json.Serialization;
using Vessel.Domain.Credentials;

namespace Vessel.Application.Credentials;

public interface ICredentialVault
{
    bool IsConfigured { get; }
    SealedCredential Seal(Guid ownerId, Guid accountId, string purpose, string plaintext);
    string Open(Guid ownerId, Guid accountId, string purpose, SealedCredential credential);
}

public sealed class CredentialStorageException() : Exception("Credential storage is unavailable. Re-enter the read-only token after configuring storage.");

public interface IAccountCredentialReader
{
    Task<string?> ReadAsync(Guid accountId, CancellationToken cancellationToken);
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
