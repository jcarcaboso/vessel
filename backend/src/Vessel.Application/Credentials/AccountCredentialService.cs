using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Credentials;

namespace Vessel.Application.Credentials;

public sealed class AccountCredentialService(
    IWorkspaceStore accounts, IAccountCredentialStore credentials, IJournalOwnerContext owner,
    IVenueRegistry venues, IEnumerable<IVenueCredentialVerifier> verifiers, ICredentialVault vault, TimeProvider time)
{
    // Read-only: no row lock, so opening Manage account does not wait behind a running refresh.
    public async Task<AccountCredentialDto> GetAsync(Guid id, CancellationToken ct)
    {
        var account = await accounts.AccountAsync(id, ct) ?? throw new WorkspaceException(404, "Account not found.");
        Guard(account, requireEnabled: false);
        var credential = await credentials.FindAsync(id, Purpose(account), ct);
        return Metadata(account, credential);
    }

    public Task<AccountCredentialDto> PutAsync(Guid id, SaveAccountCredentialRequest request, CancellationToken ct) =>
        accounts.WithAccountLockAsync(id, async account =>
        {
            Guard(account, requireEnabled: true);
            if (!vault.IsConfigured) throw new WorkspaceException(503, "Credential storage is not configured.");
            if (string.IsNullOrEmpty(request.Token) || request.Token.Length > 512)
                throw new WorkspaceException(400, "Enter a read-only token of at most 512 characters.");
            var verifier = verifiers.SingleOrDefault(v => v.VenueId == account.VenueId)
                ?? throw new WorkspaceException(503, "Credential verification is unavailable.");
            VerifiedVenueCredential verified;
            try
            {
                verified = await verifier.VerifyAsync(account.SourceId!, request.Token, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception)
            {
                // Adapters are an external boundary. Never forward even a WorkspaceException from them.
                throw new WorkspaceException(400, "The venue did not accept this read-only token.");
            }
            var now = time.GetUtcNow();
            if (verified.Scope is not ("single" or "all") || verified.ExpiresAt <= now)
                throw new WorkspaceException(400, "The venue did not accept this read-only token.");
            var purpose = Purpose(account);
            SealedCredential sealedCredential;
            try { sealedCredential = vault.Seal(owner.OwnerId, id, purpose, request.Token); }
            catch (CredentialStorageException) { throw new WorkspaceException(503, "Credential storage is unavailable."); }
            var previous = await credentials.FindAsync(id, purpose, ct);
            var credential = new AccountCredential
            {
                OwnerId = owner.OwnerId, AccountId = id, Purpose = purpose,
                KeyId = sealedCredential.KeyId, Nonce = sealedCredential.Nonce,
                Ciphertext = sealedCredential.Ciphertext, Tag = sealedCredential.Tag,
                Scope = verified.Scope, ExpiresAt = verified.ExpiresAt.ToUniversalTime(),
                CreatedAt = previous?.CreatedAt ?? now, LastVerifiedAt = now
            };
            await credentials.SaveAsync(credential, ct);
            return Metadata(account, credential);
        }, ct);

    public async Task DeleteAsync(Guid id, CancellationToken ct) =>
        await accounts.WithAccountLockAsync(id, async account =>
        {
            Guard(account, requireEnabled: false);
            await credentials.DeleteAsync(id, Purpose(account), ct);
            return true;
        }, ct);

    private void Guard(Account account, bool requireEnabled)
    {
        if (account.OwnerId != owner.OwnerId) throw new WorkspaceException(404, "Account not found.");
        if (requireEnabled && !account.IsEnabled) throw new WorkspaceException(409, "Enable the account before reading or changing its credential.");
        if (venues.Descriptor(account.VenueId)?.Capabilities.ReadOnlyCredential != true || account.SourceId is null)
            throw new WorkspaceException(400, "This account does not support read-only credentials.");
    }

    private AccountCredentialDto Metadata(Account account, AccountCredential? credential)
    {
        if (credential is null) return new(vault.IsConfigured, null);
        var status = credential.ExpiresAt <= time.GetUtcNow() ? "expired"
            : credential.ExpiresAt <= time.GetUtcNow().AddDays(14) ? "expiring" : "valid";
        if (!vault.IsConfigured || credential.LastError is not null) status = "unavailable";
        else
        {
            try { _ = vault.Open(owner.OwnerId, account.Id, Purpose(account), credential.Sealed()); }
            catch (CredentialStorageException) { status = "unavailable"; }
        }
        return new(vault.IsConfigured, new(credential.Scope, credential.ExpiresAt, credential.LastVerifiedAt, status));
    }

    private static string Purpose(Account account) => account.VenueId + "-read-token";
}
