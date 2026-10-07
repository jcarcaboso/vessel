using Vessel.Application.Ownership;
using Vessel.Application.Workspace;

namespace Vessel.Application.Credentials;

// Kept separate from the management service: venue verifiers may themselves depend on this reader.
public sealed class AccountCredentialReader(IWorkspaceStore accounts, IAccountCredentialStore credentials,
    IJournalOwnerContext owner, ICredentialVault vault, TimeProvider time) : IAccountCredentialReader
{
    public Task<string?> ReadAsync(Guid accountId, CancellationToken cancellationToken) =>
        accounts.WithAccountLockAsync(accountId, async account =>
        {
            if (account.OwnerId != owner.OwnerId) throw new WorkspaceException(404, "Account not found.");
            if (!account.IsEnabled) throw new WorkspaceException(409, "Enable the account before reading its credential.");
            var purpose = account.VenueId + "-read-token";
            var credential = await credentials.FindAsync(accountId, purpose, cancellationToken);
            if (credential is null || credential.ExpiresAt <= time.GetUtcNow() || credential.LastError is not null || !vault.IsConfigured)
                return null;
            try { return vault.Open(owner.OwnerId, accountId, purpose, credential.Sealed()); }
            catch (CredentialStorageException) { return null; }
        }, cancellationToken);
}
