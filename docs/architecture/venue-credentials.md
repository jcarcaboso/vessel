# Venue credentials: secure storage

October 5, 2026. The owner approved storing a Lighter **read-only** token so Vessel can read orders. This is the first secret Vessel keeps on behalf of the owner. The design below applies to any later venue credential, but only read-only credentials are in scope. Vessel never stores keys that can trade or withdraw.

## Threats considered

| Threat | Requirement |
| --- | --- |
| Database dump or backup leaks (most likely: `pg_dump`, the volume, a copied backup) | Ciphertext in the database is useless without a key kept outside the database. |
| Ciphertext copied onto another account's row | Decryption is bound to owner, account and purpose. |
| Token echoed to the browser, logs, exceptions or OpenAPI examples | Write-only API; plaintext stays in request-processing memory and the venue adapter's authenticated request, never in responses or stored facts. |
| A trading-capable token pasted by mistake | Accept only Lighter's `ro:` format, and only for the same account index. |
| Lost or rotated encryption key | Keys carry IDs. Old keys stay decrypt-only until re-encryption, and losing the key only means re-entering tokens. |

Out of scope: a compromised API host. A process that must call the venue can always read the token.

## Options compared

| Option | Verdict |
| --- | --- |
| **Application-level AES-256-GCM with a master key outside the DB** (`System.Security.Cryptography.AesGcm`, versioned key ring from a mode-600 file or environment) | **Chosen.** No new runtime dependency. Associated data binds each ciphertext to its row. Prefer the private key file; database backups must exclude it. |
| ASP.NET Core Data Protection | Not selected. Microsoft permits long-term confidential storage, though it is not the primary use case. It still needs persistent, protected keys on Linux and a migration from the existing GCM envelope. Key expiry does not itself make old payloads unreadable while the retired keys remain. |
| PostgreSQL `pgcrypto` | Not selected. Encryption/decryption runs in PostgreSQL, so that server sees plaintext and key material. It expands the trusted boundary without removing external key provisioning. Logging exposure depends on query construction and logging configuration, not merely use of `pgcrypto`. |
| External secret manager | Not required for local setup. The owner already operates Infisical and approved optional support on October 12. An operator helper can fetch the complete key ring through the official CLI into the same private file. It does not move venue tokens to Infisical or replace the vault. |
| OS keyring / service credentials | Not the portable baseline. Desktop keyrings need session/unlock management; systemd service credentials can work headlessly but need delivery/recovery integration. Vessel currently requires a `0600` key file, whereas systemd credentials use read-only `0400` files, so they are not interchangeable without a compatibility change. |

The [October 12 token-storage research](token-storage-research.md) compares the alternatives. The owner subsequently selected the private key file and optional Infisical support. `scripts/credential_keys.py` implements that bounded operator setup. AES-GCM, the database format and the write-only API are unchanged.

## Design

**Port (Application):** `ICredentialVault`
- `Seal(OwnerId, AccountId, Purpose, plaintext) → SealedCredential(KeyId, Nonce, Ciphertext, Tag)`
- `Open(OwnerId, AccountId, Purpose, sealed) → plaintext`

The Application layer never sees key material.

**Implementation (Infrastructure):** `AesGcmCredentialVault`
- 256-bit keys, 96-bit random nonce per seal, 128-bit tag.
- Associated data = `vessel:credential:v1|{ownerId}|{accountId}|{purpose}`.
- Configured under `Vessel:Credentials`: `ActiveKeyId`, and `Keys:{id}` (base64, 32 bytes) or `KeyFile`, an absolute path to a mode-600 JSON key ring. The file and inline configuration cannot be combined. Validated at startup (`ValidateOnStart`, like `Vessel:Evidence`). With no key configured, the API starts. Credential metadata remains readable with `storageConfigured: false`, saving answers 503, and deletion remains available. Public sync keeps working.
- Development: `pnpm dev` reads `Vessel__Credentials__…` from root `.env` and never passes it to Vite, like the auth token. The operator setup below generates a key without printing it.
- Rotation: retain the old key, add a new key, switch `ActiveKeyId`, restart the API, and re-enter each saved token through account management. New saves use the active key; existing ciphertext can still use the retained keys. Remove the old key only after replacing every credential that uses it. The proposed bulk reseal command is not implemented.

**Persistence:** a table `account_credentials`, one row per account and purpose:
- `account_id` (FK, cascade delete with the account), `owner_id`, `purpose` (`lighter-read-token`)
- `key_id`, `nonce`, `ciphertext`, `tag`
- non-secret metadata parsed before sealing: `scope` (`single|all`), `expires_at`, `created_at`, `last_verified_at`, `last_error`

Owner scope and the account lock apply as for other account writes.

**API:** write-only.
- `PUT /api/accounts/{id}/credential` with `{ token }` validates, verifies at the venue, seals and stores.
- `DELETE /api/accounts/{id}/credential` removes it.
- `GET /api/accounts/{id}/credential` returns `{ storageConfigured, credential: { scope, expiresAt, lastVerifiedAt, status } | null }`. Metadata is loaded only when managing the credential, not added to every account list. No endpoint ever returns the token, a prefix or a hash.

**Validation for Lighter before sealing:**
- The token matches `^ro:(\d{1,19}):(single|all):(\d{10}):[0-9a-f]+$` and is ≤ 512 characters.
- The index equals the account's index. For `all`, it must be the master index listed by `accountsByL1Address` for the same L1 address.
- The expiry lies in the future.
- One verification read (`accountActiveOrders`) succeeds. A rejected token gives 400 "Lighter did not accept this read-only token". Nothing is stored on failure.

**Handling rules:**
- Plaintext is handled in memory while verifying, sealing and reading a credential. Only the venue adapter sends it, in the `Authorization` header. It is never placed in a URL (`auth=` query parameter), exception message, log scope or `RawJson`.
- Venue HttpClients already use `RemoveAllLoggers()`. Keep it, and add a test that a failing venue read with a credential never includes the token in the exception or problem details.
- Expiry within 14 days shows a warning on the account. After expiry, order reads stop with "Token expired: enter a new read-only token". Snapshots and fills continue on public reads.
- Deleting the account deletes the credential. Disabling it keeps the credential but blocks every read, as disable already does.

## Operator setup

Use HTTPS for non-loopback production deployments. Production browser builds block venue-token entry on plaintext LAN origins. Outside the explicitly named Development environment, the API rejects token-bearing credential requests (`PUT` save, `POST` name preview) with 403 unless the request is HTTPS or a direct loopback request to a loopback host. Only loopback proxies may set `X-Forwarded-Proto`/`X-Forwarded-For`, so a same-host TLS-terminating proxy is recognised while a remote client cannot claim HTTPS. Metadata reads and removal carry no token and stay available. When a venue explicitly refuses a stored token during a refresh, the credential is marked `refused`: status reports `unavailable`, order tracking stops using it and saving a verified token clears it. Timeouts and outages do not mark it. Production reverse proxies must terminate TLS before accepting credentials; do not enable request-body logging on credential routes.

October 12 owner exception: HTTP token entry is allowed when using the Vite development build and an API running in Development. The token input shows a visible warning that HTTP does not encrypt transport. `pnpm dev:lan` already selects Development for the API and starts the Vite dev server. Standard frontend production builds do not get this exception; staging and custom API environment names also keep the guard. An HTTP header cannot select the server environment. This changes transport policy only: Vessel authentication, ownership checks, request limits, read-only verification and encrypted storage still apply. Use this exception only on a trusted test network; prefer synthetic or short-lived tokens. A production frontend paired with a development API remains blocked by the browser, and a development frontend paired with a production API is rejected by the server. Restart/rebuild the API after this code change; refresh the browser.

### Local key file, the default

Run the helper on the Linux host as the API's OS user. It uses Python's standard library and does not need Infisical. For a **first-time credential store only**:

```sh
install -d -m 700 "$HOME/.config/vessel-secrets"
python3 scripts/credential_keys.py init \
  --key-file "$HOME/.config/vessel-secrets/credential-keys.json" \
  --new-installation
```

The helper generates 32 random bytes, writes a mode-600 file without printing its contents, and leaves a valid existing file unchanged. It refuses invalid files, symlinks, hard links, loose permissions, paths inside repositories and concurrent helper writers. The parent directory must already exist, be owned by the invoking user and have mode 700. Failed retrieval or validation never replaces the existing ring.

`--new-installation` is an explicit operator assertion, not a database check. Do not use it to replace a missing key when saved credentials exist. Restore the original ring. The helper never runs during normal API startup, and a configured but missing key file makes startup fail rather than generating a replacement.

If inline configuration already protects saved tokens, copy those exact key IDs and bytes into the file format below instead of generating a new ring.

Set only the path in the ignored root `.env`, a private service environment file or container configuration:

```text
Vessel__Credentials__KeyFile=/absolute/path/to/vessel-secrets/credential-keys.json
```

Use the actual expanded absolute path, not a literal `$HOME` in `.env`. Remove any `Vessel__Credentials__ActiveKeyId` and `Vessel__Credentials__Keys__…` values when selecting the file source. Restart the API and choose **Refresh credential status** in account management before entering the Lighter token.

The file uses the existing format:

```json
{
  "ActiveKeyId": "current",
  "Keys": {
    "current": "<base64 output from your own 32-byte key>"
  }
}
```

Existing inline `ActiveKeyId` / `Keys__<id>` configuration remains supported for deployments that already provision it securely. Do not combine inline keys with `KeyFile`. New setups should use the helper rather than print a generated key into terminal history.

`pnpm dev` forwards credential settings to the API only and removes `Vessel__*` and `INFISICAL_*` settings from the Vite process. There is no `VITE_*` credential setting. Invalid or partially configured rings fail API startup with a fixed message, without echoing keys.

For containers, persist the file outside the database volume and mount its protected directory read-only into the API container. Use the container-visible path and verify the effective API user can read the mode-600 file. Do not bake it into an image. A container recreation must retain the same key IDs and bytes.

### Optional Infisical provisioning

Infisical supplies the **encryption key ring**, not individual Lighter tokens. The API still reads a local mode-600 file and keeps encrypted tokens in PostgreSQL. No Infisical SDK, API-host background agent or application network call is added. A plaintext copy of the master key still exists on the host.

Before switching an existing installation:

1. Back up the current ring separately and securely.
2. Store its **complete, unchanged JSON** as the shared Infisical secret `VESSEL_CREDENTIAL_KEY_RING` in a dedicated folder. Preserve every key ID and byte, including retired keys. Use a secure UI/upload workflow, not a shell argument or terminal dump.
3. Give the deployment's machine identity read access only to that project, environment and folder. The official CLI retrieves the folder before selecting the requested secret, so keep this folder dedicated to the ring.
4. Install and authenticate the official Infisical CLI on the provisioning host. Existing CLI authentication is supported. For unattended use, the optional `--access-token-file` reads a machine identity access token from another private mode-600 file in an owned mode-700 directory and supplies it only to the CLI child environment. Token issuance and renewal stay with the deployment tooling; the helper does not create identities or renew expired tokens.
5. Fetch explicitly, then restart the API only after a successful exit:

```sh
python3 scripts/credential_keys.py fetch-infisical \
  --key-file "$HOME/.config/vessel-secrets/credential-keys.json" \
  --domain "https://infisical.example.com" \
  --project-id "YOUR_PROJECT_ID" \
  --environment "prod" \
  --secret-path "/vessel-keys" \
  --access-token-file "$HOME/.config/vessel-secrets/infisical-access-token"
```

Replace the example domain and project ID with your deployment. Omit `--access-token-file` only when the CLI already has suitable authentication. The token itself must never be a command-line argument. Use trusted HTTPS certificates; there is no insecure-HTTP option.

The helper calls `infisical secrets get` with explicit project/environment/path, shared secrets only, and expansion, imports and recursion disabled. It captures stdout privately, discards CLI stderr, bounds output to 64 KiB and execution to 30 seconds, validates the complete ring and publishes it atomically. A matching ring is a no-op. Missing CLI, expired authentication, access denial, outages, empty output and malformed data fail with non-secret diagnostics, without a local fallback. If used as a service pre-start step, its failure must block that start. Do not append `|| true`.

For rotation, add a new key in Infisical, retain all existing keys unchanged, and switch `ActiveKeyId`. Fetch with `--update`, then restart the API. The helper refuses key removal or reuse of an ID with different bytes even with `--update`. Removing retired keys remains a deliberate manual operation only after all ciphertext using them has been replaced. There is no polling, hot reload or automatic bulk re-encryption.

Switching the source with identical keys needs no database migration or token re-entry. Infisical outages do not affect an already-running API with its ring loaded, but do prevent an explicitly configured fetch from succeeding. No live Infisical instance is contacted by the repository tests.

The integration follows the official [Infisical CLI secret command implementation](https://github.com/Infisical/cli/blob/main/packages/cmd/secrets.go) and [machine identity authentication](https://infisical.com/docs/documentation/platform/identities/universal-auth). CLI flags were checked on October 12, 2026. An installed CLI that does not support these flags fails closed; no older-command fallback is attempted.

### Backup and recovery

Back up the key ring separately from PostgreSQL and restrict both copies. If the keys are lost, snapshots and imported facts remain, but saved tokens must be re-entered. Deleting a token in Vessel removes its local ciphertext; revoke it in Lighter as well if it should stop working elsewhere.

Test restore with synthetic credentials and an isolated database before relying on a backup procedure. Restore the same key IDs and bytes with the correct owner and mode 600. If every copy is irrecoverably lost, deliberately remove unusable saved credentials, provision a new ring and re-enter replacement read-only tokens. Do not silently overwrite the missing ring while treating old credentials as usable.

### Troubleshooting token entry

- **Disabled input on a LAN HTTP page:** production builds require HTTPS or loopback access. For the approved development exception, use the Vite dev server and the Development API, as `pnpm dev:lan` does, then restart the API and refresh the page. Check the storage-configured notice too. Do not label a production deployment Development to bypass the guard.
- **“Credential storage is not configured”:** configure the server-only key ring above, restart the API, then choose **Refresh credential status**. Public discovery working does not mean encrypted token storage is configured.
- **Secure-connection error when the page already uses HTTPS:** check the TLS-terminating proxy and its forwarded scheme/client headers. The API trusts loopback proxies only; do not trust arbitrary forwarded headers to work around this.
- **Vessel authentication rejected:** reconnect with the Vessel API token, not the Lighter token.
- **Verification failure:** use the complete `ro:` token, check expiry, and select single scope for the account or all scope from its main account. Never use a trading API key.
- **Timeout or unconfirmed save:** check credential status in **Manage account** before retrying. The account import is retained; do not import it again.

October 12, 2026: save and name-preview requests trim surrounding pasted whitespace in both the browser and API. The API verifies and encrypts the same trimmed value; internal whitespace, token syntax, scope, expiry and request-size checks remain enforced. The browser distinguishes transport, Vessel authentication, account-state and service/storage failures using local messages keyed by HTTP status, without displaying upstream error bodies. These regression fixes do not establish which deployment setting blocked the owner's token entry; that still requires the disabled-field notice or failing request status.
