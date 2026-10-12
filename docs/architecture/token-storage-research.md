# Read-only token storage research

Research and proposal only. No new storage design or implementation is approved by this note.

Subsequent owner decision, October 12: use the private key file now and support the owner's existing Infisical deployment later. The [credential operations](venue-credentials.md#operator-setup) document the implemented local initializer and opt-in Infisical CLI provisioning. The comparison below remains the research record, not the current setup instructions.

Sources retrieved October 12, 2026. Three independent agents compared framework storage, host-key provisioning, and session/external-service alternatives. This note combines their research with an audit of the current single-user, self-hosted Vessel implementation.

## Repository facts

`venue-credentials.md` and the credential implementation already provide encrypted storage:

- `AesGcmCredentialVault.cs` uses .NET AES-256-GCM, random 96-bit nonces, 128-bit tags and authenticated owner/account/purpose binding.
- `CredentialSettings.cs` accepts versioned keys outside PostgreSQL. Its Unix `KeyFile` requires an absolute, non-symlink file with exactly `0600` permissions. Inline configuration is also supported. Missing configuration leaves public reads available but prevents credential saves.
- `AccountCredentialService.cs` verifies before encrypting and exposes metadata, not plaintext. `AccountCredentialReader.cs` blocks disabled, expired or refused credentials.
- `VesselDbContext.cs` enforces the GCM envelope shape. Old keys remain usable after changing the active key; rotation does not rewrite rows. The documented replacement procedure is token re-entry, not an implemented bulk migration.

No live configuration or keys were inspected. The user's actual deployment blocker remains unverified. An unconfigured key ring and non-loopback HTTP are separate intentional blockers, not proof that the storage mechanism is missing.

The audit reran 53 vault/API/transport tests successfully with no skips. These are controlled tests, not verification of the owner's live token or deployment.

## Read-only does not mean public

Lighter's `ro:` tokens cannot sign transactions, trade or withdraw. `single` covers one account; `all` covers the main account and its subaccounts. They grant authenticated reads, including active orders, so disclosure can reveal trading intent. Lighter documents a one-day to ten-year lifetime, not the eight-hour limit of ordinary auth tokens. Creation defaults to `read.*`; the reference does not document narrower endpoint scopes. [8][9][10]

The useful threat boundary is database-only or backup-only leakage, accidental logging and unauthorized reads. A separate key protects the token in a database dump; it does not protect financial facts already imported into that database. A process that can legitimately use a token can also expose it if compromised. This remains true with a remote secret manager. These are engineering conclusions from the current data flow and the security guidance. [7][11]

## Official findings

1. Microsoft explicitly permits long-term confidential storage with Data Protection, while saying indefinite storage is not its primary use. That caveat is not a categorical prohibition. [1]
2. Data Protection persists keys, not just encrypted payloads. Containers need a persistent volume or external repository. Windows DPAPI protection does not apply on Linux. An explicit repository disables automatic key-at-rest encryption unless protection is configured separately. A Linux file-based ring is not automatically encrypted. [2][3]
3. Default payload protection is authenticated AES-256-CBC plus HMACSHA256. Default key lifetime is 90 days; expired keys still decrypt retained payloads. This is key rotation, not automatic re-encryption of database rows. That last distinction follows from the documented new-protection/old-unprotection behavior. [2][4]
4. `SetApplicationName` provides a stable discriminator instead of relying on deployment paths. Purpose chains separate consumers; a Vessel implementation would include a fixed versioned prefix, owner, account and purpose. This isolation does not defend against malicious code already running in the same process. [5][6]
5. Revoking a Data Protection key blocks normal decryption; deleting the last copy permanently loses its payloads. Neither operation revokes a venue token. OWASP recommends authenticated encryption, separating keys from data, restrictive permissions and avoiding environment-variable keys when possible. [4][7]

## Trade-offs and migration cost

| Choice | Pros | Cons | Migration |
| --- | --- | --- | --- |
| Keep existing AES-GCM plus private key file | Already implemented; no service or dependency; explicit row binding; database dumps exclude keys | Vessel owns envelope validation and rotation procedures; plaintext key file relies on host permissions; no automatic reseal | None for existing ciphertext; operator setup and restore verification |
| Data Protection plus persistent private directory | Framework-managed encryption, key generation and rotation; built-in purpose separation; no external service | Linux still needs key custody; writable persistent ring; more lifecycle rules; unencrypted ring offers no custody improvement over current file | Moderate; versioned opaque-payload storage instead of current nonce/tag constraints, revised key-status checks, migration and recovery tests |
| Data Protection plus certificate-protected ring | Encrypts ring backups separately from the wrapping private key | Another secret and lifecycle; little benefit if certificate/private key and ring leak together; still needs filesystem permissions | Above migration plus certificate provisioning, rotation and backup recovery |

The comparisons are engineering judgments based on the repository and [2]-[7], not measured implementation estimates.

## Supplying the existing vault's key

| Choice | Pros | Cons and compatibility |
| --- | --- | --- |
| Environment or `.env` | Already supported, no new code, portable | Secret-bearing configuration/process environments can leak during diagnostics. Keep outside source/images and back up separately. Acceptable manual option, but not the preferred deployment default. [7][12] |
| Persistent private JSON file | Already supported; ordinary configuration carries only the path; no extra service; works across Linux hosts and containers | Requires protected directory, correct API-user ownership, persistence and recovery. Permissions do not encrypt a stolen disk. Current reader requires exactly `0600`. |
| Compose file secret | Per-service access and read-only file delivery without putting the value in the container environment | Bind-mounts a plaintext host file. Not encrypted Swarm storage. For file sources Compose ignores permission/ownership overrides, so validate the source and effective container permissions. Can preserve the current `0600` requirement. [12][13] |
| systemd credentials | Service-scoped read-only delivery; encrypted credentials can use TPM-backed protection without a new daemon | Platform/hardware-specific recovery. Current systemd implementation creates `0400` credential files with possible service-user ACLs, incompatible with Vessel's exact-`0600` check. Host-only wrapping is not equivalent to TPM protection against whole-disk theft. Optional future adapter/permission work, not plug-and-play today. [14][15][16] |

Swarm has encrypted secret storage, but adds a cluster/service operating model. Autolock protects its stored encryption key while requiring manager unlock after restarts. Do not introduce Swarm solely for Vessel's credentials. [17]

Desktop Secret Service uses a login-session D-Bus service and may need an unlock prompt. It is not universally unavailable headlessly, but is not a portable container/service default. Windows DPAPI is Windows-specific. [18]

## Other storage alternatives

| Choice | Pros | Cons and fit |
| --- | --- | --- |
| Server-memory only | No intentional token persistence or key provisioning | Re-enter tokens after restart. Order reads cannot resume until then; memory dumps, swap and runtime compromise remain relevant. Reasonable only for deliberately occasional manual use. [7][11] |
| Manually unlocked encrypted store | Better offline-host protection when the unlocking secret is genuinely absent from disk | Adds unlock UI, password derivation, recovery and lock-state handling. Weak passphrases permit offline guessing. Unattended restart is lost; a compromised unlocked runtime still has access. [7] |
| Plaintext tokens in PostgreSQL or private files | Fewest implementation steps | File/table readers and their backups contain reusable tokens. Reject as the default; the current vault already avoids this with no extra service. [7] |
| Managed secret manager | Tokens live outside PostgreSQL; central permissions and retrieval audit; no extra server to maintain | Needs workload identity, network access, policies, billing and recovery. Returns plaintext to authorized runtime. Provider-managed secret rotation does not automatically implement Lighter token renewal. Useful when infrastructure/identity already exists. [8][19] |
| KMS envelope encryption | Keep ciphertext in PostgreSQL while a remote service protects the key that wraps data keys | Not a token store. Vessel still handles encryption and payload lifecycle; adds identity/network dependencies. Authorized runtime obtains usable data keys/tokens. Consider for multiple hosts or independent key-custody/audit requirements. [20] |
| Self-hosted Vault | Central secret or encryption service shared across applications | Another service to secure, patch, authenticate, back up and unseal. Auto-unseal delegates trust to another key service. Too much for one Vessel installation unless already operated. [21] |

Remote storage moves the bootstrap problem rather than eliminating it. An off-cloud workload still needs an identity, such as certificate-backed temporary credentials, instead of simply adding a new long-lived access key to `.env`. [22]

PostgreSQL `pgcrypto` is also viable cryptography but offers no simplification here. Encryption/decryption execute in PostgreSQL, expanding which server sees plaintext and key material. PostgreSQL explicitly requires trusting database/system administrators and protecting client-server transport. This, rather than a blanket claim that every parameter appears in query logs, is the relevant drawback. [23]

## Rotation, removal and recovery

For either approach, changing the active encryption key affects new saves, not already-stolen tokens or ciphertext. Re-encrypt retained rows before removing their old keys. Retain separately protected old keys while recoverable database backups need them, or explicitly accept token re-entry after restore. Test recovery without production secrets. [4][7]

For certificate-protected Data Protection, retain old decryption certificates during certificate rotation; changing the wrapping certificate is distinct from rotating payload keys or resealing tokens. Microsoft supports multiple decryption certificates. [5]

Deleting a credential removes the live row, not historical backups. Revoke the token at the venue when it must stop working elsewhere. Lighter documents `tokens/revoke`; rotating Vessel's encryption key is not venue revocation. Shared encryption-key deletion cannot selectively erase one account. These conclusions follow from the repository's delete path, shared-key design and Lighter's separate revocation API. [24]

## Recommendation and assumptions

Keep AES-GCM. Prefer the existing private key-file option over inline environment keys, outside the repository and database backup set, readable only by the API identity. A read-only container mount can preserve the required `0600` file mode. Keep HTTPS entry and write-only handling.

Manual provisioning already works. The proposed product improvement is a small, explicit setup flow, not replacement cryptography:

1. Add an opt-in operator command that creates one random 32-byte key in a persistent, protected directory outside the repository, image and database volume. Only the API receives the key-file path. It never prints the key.
2. Create exclusively with restrictive permissions and validate before reporting success. An existing valid file is a no-op; invalid, symlinked or inaccessible files are errors. Concurrent or interrupted attempts must never truncate a valid ring. .NET supplies exclusive creation and Unix creation-mode primitives. [25]
3. Normal startup never generates or replaces keys. A missing file is not proof of a fresh installation. Refuse fresh initialization when retained credentials or previous-initialization evidence exists; require an explicit recovery procedure instead. Public reads can remain available.
4. Make the existing storage/transport status and corrective instructions easier to find. Preserve write-only handling, no secret logging and HTTPS. Local development can use loopback or an SSH tunnel rather than weakening the LAN rule.
5. Document persistent mounts and separate protected backups. Test restarts, container recreation, restore, missing keys, permissions and rotation with synthetic credentials. Losing the ring can be recovered by re-entering replacement venue tokens; retained imported history is independent.

Keep one account's scope where practical, finite expiry and the existing expiry warnings. If compromise is suspected, revoke/replace the venue token as well as addressing key custody. No automatic venue-token creation or rotation is proposed.

Encrypt key backups separately; do not bundle accessible keys with database exports. Neither local candidate protects against a compromised API process that must decrypt tokens. [7][11]

This recommendation assumes a few recoverable read-only tokens, one trusted host and no mandatory central key service. Reconsider Data Protection if framework-managed rotation becomes worth the migration. It is viable, but does not solve key custody by itself.

## Primary sources

- [1] Microsoft, scope and long-term storage: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction?view=aspnetcore-10.0
- [2] Microsoft, defaults and containers: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/default-settings?view=aspnetcore-10.0
- [3] Microsoft, key encryption: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-encryption-at-rest?view=aspnetcore-10.0
- [4] Microsoft, key lifecycle: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-management?view=aspnetcore-10.0
- [5] Microsoft, configuration and certificates: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0
- [6] Microsoft, purposes: https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/purpose-strings?view=aspnetcore-10.0
- [7] OWASP, encryption and custody: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- [8] Lighter, read-only permissions and lifetimes: https://apidocs.lighter.xyz/docs/api-keys
- [9] Lighter, token creation and scopes: https://apidocs.lighter.xyz/reference/tokens_create
- [10] Lighter, authenticated active orders: https://apidocs.lighter.xyz/reference/accountactiveorders
- [11] OWASP, secret lifecycle, transport and recovery: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- [12] Docker, Compose file-secret delivery: https://docs.docker.com/compose/how-tos/use-secrets/
- [13] Docker, Compose secret permission limitations: https://docs.docker.com/reference/compose-file/services/#secrets
- [14] systemd, credential delivery: https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.exec.xml
- [15] systemd, encrypted credentials and TPM: https://raw.githubusercontent.com/systemd/systemd/main/man/systemd-creds.xml
- [16] systemd, runtime credential file modes: https://raw.githubusercontent.com/systemd/systemd/main/src/core/exec-credential.c
- [17] Docker, Swarm secrets and autolock: https://docs.docker.com/engine/swarm/secrets/ and https://docs.docker.com/engine/swarm/swarm_manager_locking/
- [18] Freedesktop, Secret Service sessions: https://specifications.freedesktop.org/secret-service/latest-single/ ; Microsoft, Windows ProtectedData: https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=netframework-4.8
- [19] AWS, Secrets Manager retrieval and operation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html and https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets.html
- [20] AWS, KMS and envelope encryption: https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html and https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html
- [21] HashiCorp, Vault engines and unseal: https://developer.hashicorp.com/vault/docs/secrets/kv ; https://developer.hashicorp.com/vault/docs/secrets/transit ; https://developer.hashicorp.com/vault/docs/concepts/seal
- [22] AWS, off-cloud workload identity: https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html
- [23] PostgreSQL, pgcrypto security limits: https://www.postgresql.org/docs/current/pgcrypto.html#PGCRYPTO-SECURITY
- [24] Lighter, venue token revocation: https://apidocs.lighter.xyz/reference/tokens_revoke
- [25] Microsoft, safe file creation: https://learn.microsoft.com/en-us/dotnet/api/system.io.filemode?view=net-10.0 and https://learn.microsoft.com/en-us/dotnet/api/system.io.filestreamoptions.unixcreatemode?view=net-10.0
