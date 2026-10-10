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
| **Application-level AES-256-GCM with a master key outside the DB** (`System.Security.Cryptography.AesGcm`, versioned key ring from a mode-600 file or environment) | **Chosen.** No new dependency, explicit and testable. Associated data binds each ciphertext to its row, and DB backups stay safe. It fits the current `.env` and systemd `EnvironmentFile` operation. |
| ASP.NET Core Data Protection | Rejected as the store. Microsoft states it is "not primarily intended for indefinite persistence of confidential payloads". Its key ring must still be protected outside the DB, and expiry/revocation semantics add risk for tokens that live for years. |
| PostgreSQL `pgcrypto` | Rejected. The key travels in SQL text, where statement logs and `pg_stat_statements` can expose it, and the DB holds key and data together. |
| External secret manager (OpenBao/Vault, Infisical, SOPS) | Not now: too much to operate for a single-user self-hosted app. The `ICredentialVault` port lets one replace the local vault later, the same way `IEvidenceObjectStore` admits S3. |
| OS keyring | Not available to a container or systemd service user. |

## Design

**Port (Application):** `ICredentialVault`
- `Seal(OwnerId, AccountId, Purpose, plaintext) → SealedCredential(KeyId, Nonce, Ciphertext, Tag)`
- `Open(OwnerId, AccountId, Purpose, sealed) → plaintext`

The Application layer never sees key material.

**Implementation (Infrastructure):** `AesGcmCredentialVault`
- 256-bit keys, 96-bit random nonce per seal, 128-bit tag.
- Associated data = `vessel:credential:v1|{ownerId}|{accountId}|{purpose}`.
- Configured under `Vessel:Credentials`: `ActiveKeyId`, and `Keys:{id}` (base64, 32 bytes) or `KeyFile`, an absolute path to a mode-600 JSON key ring. The file and inline configuration cannot be combined. Validated at startup (`ValidateOnStart`, like `Vessel:Evidence`). With no key configured, the API starts. Credential metadata remains readable with `storageConfigured: false`, saving answers 503, and deletion remains available. Public sync keeps working.
- Development: `pnpm dev` reads `Vessel__Credentials__…` from root `.env` and never passes it to Vite, like the auth token. `docs/development.md` documents generating a key with `openssl rand -base64 32`.
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

Use HTTPS for any non-loopback deployment. The browser blocks venue-token entry on plaintext LAN origins, and the API rejects token-bearing credential requests (`PUT` save, `POST` name preview) with 403 unless the request is HTTPS or a direct loopback request to a loopback host. Only loopback proxies may set `X-Forwarded-Proto`/`X-Forwarded-For`, so a same-host TLS-terminating proxy is recognised while a remote client cannot claim HTTPS. Metadata reads and removal carry no token and stay available. When a venue explicitly refuses a stored token during a refresh, the credential is marked `refused`: status reports `unavailable`, order tracking stops using it and saving a verified token clears it. Timeouts and outages do not mark it. A reverse proxy must terminate TLS before accepting credentials; do not enable request-body logging on credential routes. The HTTP LAN preview is not a place to enter a real token.

Generate a master key locally with `openssl rand -base64 32`. Do not send it to the browser, put it in a shell argument or commit it. Configure these server-only settings in the ignored root `.env`, a private systemd environment file, or the container's secret configuration:

```text
Vessel__Credentials__ActiveKeyId=current
Vessel__Credentials__Keys__current=<base64 output from your own 32-byte key>
```

Alternatively, set only `Vessel__Credentials__KeyFile` to an absolute path outside the repository. The JSON file has the following shape and must be mode 600 on Unix:

```json
{
  "ActiveKeyId": "current",
  "Keys": {
    "current": "<base64 output from your own 32-byte key>"
  }
}
```

`pnpm dev` forwards credential settings to the API only and removes all `Vessel__*` settings from the Vite process. There is no `VITE_*` credential setting. Invalid or partially configured key rings fail API startup with a fixed message, without echoing key values.

Back up the key ring separately from PostgreSQL and restrict both copies. If the keys are lost, snapshots and imported facts remain, but saved tokens must be re-entered. Deleting a token in Vessel removes its local ciphertext; revoke it in Lighter as well if it should stop working elsewhere.
