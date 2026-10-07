# Lighter account import delivery

October 7, 2026. The owner authorized implementation and a pull request after RISEx, with secure credential entry and a clean main/subaccount import flow. This supersedes the “implementation not yet authorized” note in the research plan.

## Bounded delivery

- Read-only Lighter perpetual accounts, catalogue, snapshots, bounded recent fills, candles and order linking. Market context remains unavailable until its funding fields can be populated without guessing.
- Wallet-address discovery offers concrete account indices. Import creates one Vessel account per selected index, optionally in a portfolio. Existing indices are shown as already added, including disabled accounts.
- Generic source identity replaces the address-only assumption. EVM venues keep accepting `address`; account indices use `sourceId`, represented as strings end to end.
- Read-only tokens are optional for public account reads and required for orders. They are encrypted per account, never returned, and verified before storage. No wallet signature, private key or trading token is requested.
- Manual chart refresh first. A Lighter live stream and the generic stream-relay refactor are deferred; the descriptor must not advertise an unimplemented stream.
- Imports and token saves report per-account success/failure. A token failure never hides or deletes an account already created. Refresh is explicit, not an unbounded history import.
- Keep the existing Plays layout unchanged. Do not invent missing financial values or double-count wallet and perpetual balances.

## Shared API boundary

- Venue descriptor capabilities add optional `accountDiscovery` and `readOnlyCredential` booleans, defaulting to false. Source kind `account-index` joins `evm-address` and `none`.
- `GET /api/venues/{venueId}/accounts?address=…` returns `{ venueId, address, accounts, notice }`.
- Each discovery candidate is `{ sourceId, name, accountType, accountValueUsd, existingAccountId, isEnabled }`. `accountType` is `main` or `subaccount`; balance and existing-record fields may be null. Never convert an int64 index to a JavaScript number.
- Existing `POST /api/accounts` accepts optional `sourceId`. The account DTO adds `sourceId` while preserving `address` for EVM compatibility. Identity stays immutable.
- `GET /api/accounts/{id}/credential` returns `{ storageConfigured, credential }`. Credential metadata is null or `{ scope, expiresAt, lastVerifiedAt, status }`, with statuses `valid`, `expiring`, `expired`, or `unavailable`.
- Metadata remains readable when storage is unconfigured. Saving then returns 503; deleting a saved credential does not need its encryption key.
- `PUT /api/accounts/{id}/credential` accepts `{ token }`, verifies it, then seals it and returns the same metadata envelope. `DELETE` removes it. These endpoints are owner-scoped and serialize against account changes/sync.
- Credential APIs never return a token, token prefix, hash, ciphertext, or venue error body. UI fields are password inputs kept only in component memory and cleared after submission/close.
- Credential entry requires HTTPS except on loopback development hosts. Public discovery and account import still work without credential entry.

## Backend collaboration boundary

The account/security implementation owns source identity, credential storage, discovery/credential application services, API routes, persistence migrations, and the new application ports. The Lighter adapter owns its venue module and fixtures.

New ports in Application:

- `IVenueAccountDiscovery`: `VenueId`; `DiscoverAsync(string address, CancellationToken)` returning candidates with source ID, name, type and optional exact balance.
- `IVenueCredentialVerifier`: `VenueId`; `VerifyAsync(string sourceId, string token, CancellationToken)` returning scope and expiry after venue verification.
- `IAccountCredentialReader`: `ReadAsync(Guid accountId, CancellationToken)` returning a usable read-only token or null. Order reads fail with a safe actionable message when unavailable.
- Venue reader and order-reader ports gain default overloads accepting `Account`; existing implementations delegate to the string source overload. Lighter uses the account overload to obtain its token without making source IDs global credential lookup keys.

All contributors must preserve dependency direction, owner checks, existing account/sync locks, exact numeric strings, bounded network reads, and safe errors.
