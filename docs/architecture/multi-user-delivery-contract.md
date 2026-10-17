# Multi-user wallet sign-in: delivery contract

October 17, 2026. Status: **delivery contract for implementation.** On October 17 the owner asked to start orchestrating the work, with Opus and Sol (Codex) agents to discuss and verify the approach. Round-1 reviews by GPT-6.1-Sol and Claude Opus 5.5 (both "go with changes") are folded in here.

Where this contract and [the analysis](multi-user-wallet-auth.md) disagree, this contract wins. The design screens are in [`docs/design/wallet-sign-in/`](../design/wallet-sign-in/README.md).

Implementers must not decide anything this contract leaves open. Ask the orchestrator instead.

## 1. Adopted decisions

The owner has not answered D1–D12. These are the working defaults, adopted from the recommendations as amended by both reviews. Each is a configuration value or a small code change, so the owner can override them.

| # | Decision |
| --- | --- |
| D1 | Registration policy `Invitation` by default. Policies: `Closed`, `Invitation`, `AllowList`, `Open`. **Until phase P2b merges, Wallet mode forces `Closed`** in code (§10). |
| D2 | The configured owner GUID becomes user 1 through the idempotent `identity ensure-owner` command, with role `operator`. The owner's wallet is attached with `identity bind-wallet`. No migration seeds data. |
| D3 | `Vessel:Auth:Mode` = `Token` (the default when the key is absent) or `Wallet`. The default is never flipped implicitly. In Wallet mode the bearer scheme is not registered, and startup fails if `Vessel:Auth:Token` is set. |
| D4 | No WalletConnect and no CSP change. The CSP stays exactly as today. |
| D5 | Regular wallets (EOAs) only. Unsupported signature formats get their own code; Vessel never claims to know the wallet type. |
| D6 | Several wallets per user; the last one cannot be removed. Wallet changes are serialized per user. |
| D7 | Operator tasks are offline commands first. "The operator cannot see journals" is application authorization only, not protection from whoever administers the host or database. |
| D8 | **"Keep me signed in on this device"**, unchecked by default. Unchecked: a browser-session cookie with 12 h idle and 24 h absolute expiry. Checked: a persistent cookie with 14 days idle and 30 days absolute expiry. *Sol disagreed with a long default; Opus accepted it with safeguards. This resolves both.* |
| D9 | The same venue account may be followed by several journals. Venue deadlines are server-wide (§9.4). |
| D10 | Per-user preference keys, plus a device-level theme key for the sign-in screen. Only the migrated owner adopts the legacy keys. A full reload on sign-out and on a user change. |
| D11 | No user or journal deletion. Suspension is defined now (§9.6). |
| D12 | `Chain ID: 1` fixed. |

## 2. Pull requests, lanes and write scopes

```text
base: t3/7a0854db (this contract + shared ports)
├─ Lane A (Sol):   A1 identity core ─► A2 identity account management
├─ Lane B (Sol):   B1 owner scopes + messaging ─► B2 monitor + limits (lifts the registration gate)
├─ Lane C (Opus):  C1 isolation suite (tests only)
└─ Lane D (Opus):  D1 frontend identity
then Phase 4 (orchestrator + agents): deployment, release checks, runbooks
```

| PR | Contents | Write scope (only these paths) |
| --- | --- | --- |
| A1 | `Vessel.Identity` project and the identity schema with its own migration bundle. Bootstrap commands. Sign-in, register, session, sign-out and config endpoints. Session authentication, request guard (CSRF), rate limits and the mode switch. Stream revalidation. The Wallet-mode owner directory registration for the API and worker. | `backend/src/Vessel.Identity/**`, `backend/tests/Vessel.Tests/Identity/**`, `backend/Vessel.slnx`, `backend/Dockerfile`, `deploy/migrate`. In `backend/src/Vessel.Api/`: the auth and composition sections of `Program.cs`, `ProductionConfiguration.cs`, `Vessel.Api.csproj`, `VesselEventEndpoints.cs` and `MarketStreamEndpoint.cs` (revalidation and caps only). The auth registration in `backend/src/Vessel.Infrastructure/DependencyInjection.cs`. `Vessel.Worker.csproj` plus one composition line in `Vessel.Worker/Program.cs`. `ArchitectureTests.cs` (project rows). |
| A2 | Profile, sessions list and revocation, wallets list, link, label and remove, step-up, the remaining offline commands | Lane A paths |
| B1 | `IOwnerScopeFactory` implementation, owner-scoped worker and messaging, the subscription redesign (§9.2), catch-up and retention across owners, suspended-owner handling, owner-aware offline commands, the `ConfiguredOwnerDirectory` wiring in Token mode | `backend/src/Vessel.Persistence/**` (except monitor files), `backend/src/Vessel.Infrastructure/Auth/HttpJournalOwnerContext.cs`, `backend/src/Vessel.Messaging/**`, `backend/src/Vessel.Worker/**` (except A1's one line), `backend/src/Vessel.Application/Events/**`, `backend/tests/Vessel.Tests/**` (event, messaging, worker tests) |
| B2 | Cross-owner monitor candidates, owner-scoped claims and renewals, `OwnerId` on leases, the server-state store (heartbeat, venue deadlines, venue concurrency), `WorkerConcurrency`, per-user caps (market streams, candle refresh, discovery and credential verification), lifting the A1 registration gate | Monitor files in `Vessel.Persistence` and `Vessel.Application/Monitoring/**`, `Vessel.Worker/MonitorScheduler.cs`, market data, workspace discovery and credential services, monitor tests, the gate constant in `Vessel.Identity` (one line) |
| C1 | Isolation suite: test authentication scheme, endpoint inventory, two-owner API cases with mutation assertions, worker and event two-owner cases (pending B1 and B2 where marked) | `backend/tests/Vessel.Tests/Isolation/**` only |
| D1 | Frontend identity module, dual-mode gate, transport, cross-tab handling, preferences, account menu, Profile & sign-in, copy | `frontend/src/**`, `frontend/package.json` (dev dependencies only), `pnpm-lock.yaml` |
| P4 | Compose, `.env` example, deploy README (upgrade, rollback, restore reset, own hostname), `verify-release.py` and browser scripts in both modes, release notes, AGENTS and app-status updates | `deploy/**`, `scripts/**`, `docs/**`, `AGENTS.md` |

**Shared ports** are already in the base commit, in `backend/src/Vessel.Application/Ownership/`. They are `IJournalOwnerDirectory` with `JournalOwnerStatus` and `ConfiguredOwnerDirectory`, `IOwnerScopeFactory`/`IOwnerScope`, and `IPrincipalValidity` with `AlwaysValidPrincipal`. Changing them requires the orchestrator.

**Merge order:** A1 → B1 → A2 → B2 → C1 → D1 → P4. The orchestrator integrates; small composition conflicts are expected and resolved there.

## 3. Configuration

All keys are read identically by the API, the worker and offline commands. Validation messages name settings, never values.

| Key | Values and default | Rules |
| --- | --- | --- |
| `Vessel:Auth:Mode` | `Token` (default when absent) \| `Wallet` | Any other value refuses startup |
| `Vessel:Auth:Token` | — | Token mode: required outside Development (unchanged). Wallet mode: must be absent or empty, otherwise refuse to start |
| `Vessel:Auth:OwnerId` | GUID | Token mode: as today. `identity ensure-owner` requires it explicitly and refuses the well-known default GUID outside Development |
| `Vessel:Auth:OwnerName` | `Owner` | The display name `ensure-owner` gives a new owner row |
| `Vessel:Identity:Origins` | list | Wallet mode: required, at least one entry. Each is normalized to `scheme://host[:port]` with a lower-case host, no path and no default port. Outside Development each must be `https://` or loopback `http://` |
| `Vessel:Identity:Registration` | `Invitation` | `Closed`, `Invitation`, `AllowList`, `Open`. Forced to `Closed` while the §10 gate is in place |
| `Vessel:Identity:AllowList` | empty | 0x addresses, normalized to lower case |
| `Vessel:Identity:Session:IdleHours` / `AbsoluteHours` | 12 / 24 | Without "keep me signed in" |
| `Vessel:Identity:Session:RememberIdleDays` / `RememberAbsoluteDays` | 14 / 30 | With "keep me signed in" |
| `Vessel:Identity:CookieName` | `__Host-vessel-session` | Must begin with `__Host-` unless the environment is Development |
| `Vessel:Identity:Schema` | `identity` | Tests only. The model cache key includes it |
| `Vessel:Monitor:WorkerConcurrency` | 2 | Replaces the constant in `MonitorScheduler` (B2) |
| `Vessel:Monitor:VenueReadConcurrency` | 4 | Server-wide per venue (B2) |
| `Vessel:Events:MaxStreams` | 64 | Event streams per API process, beside 4 per owner (A1) |

**Development over plain HTTP:**
- The session cookie is named `vessel-session` and has no `Secure` attribute; the binding cookie is `vessel-signin`.
- This applies only when the API environment is Development and the request origin is an `http://` entry of `Origins`.
- Other environments never issue a non-`Secure` cookie. Over HTTP, sign-in answers `403 origin-rejected`.

## 4. Identity persistence

- **Project and context.** Project `Vessel.Identity` (net10.0) references only `Vessel.Application`. Its packages are EF Core with Npgsql and Nethereum.Signer 7.x, and it has the ASP.NET Core framework reference.
- **Database.**
  - `IdentityDbContext` uses `HasDefaultSchema(schema)` and the history table `__EFMigrationsHistory` in that schema.
  - Identity has its own transaction helper and never uses the journal `IUnitOfWork`.
  - There are no foreign keys between schemas.
  - The tables below are not `IOwned`, and the journal `VesselDbContext` never maps them.
- **Migrations.** A second EF bundle, `migrate-identity-ef`, is built in the Dockerfile. `deploy/migrate` runs four steps in order:
  1. the identity bundle;
  2. the journal bundle;
  3. `identity ensure-owner`;
  4. `provision-messaging`.

  Each step is idempotent, and a failure stops the script.
- **Readiness.** `/health/ready` checks both contexts. In Wallet mode it also reports not ready, with a reason, while no active operator has a wallet.

| Table | Columns | Constraints |
| --- | --- | --- |
| `users` | `id uuid`, `display_name varchar(60)`, `role text` (`member`, `operator`), `status text` (`active`, `suspended`), `created_at`, `updated_at`, `suspended_at null`, `revision int` | PK `id`. New users get a random v4 GUID; only `ensure-owner` uses the configured GUID |
| `user_wallets` | `id uuid`, `user_id`, `address char(42)` (lower-case `0x…`), `label varchar(40) null`, `added_at`, `last_used_at null` | PK `id`, FK `user_id`, **unique `address`** |
| `auth_challenges` | `id uuid`, `purpose text` (`sign-in`, `link`, `step-up`), `address`, `origin`, `message text` (exact signed text), `binding_hash bytea null`, `user_id null`, `session_id null`, `action text null`, `target text null`, `issued_at`, `expires_at`, `consumed_at null` | Index on `expires_at`. At most 10 000 unconsumed rows; at the cap, the oldest are evicted |
| `pending_registrations` | `id uuid`, `token_hash bytea`, `address`, `origin`, `binding_hash`, `created_at`, `expires_at`, `consumed_at null` | Unique `token_hash`. Lifetime 10 min |
| `sessions` | `id uuid`, `user_id`, `wallet_id null`, `token_hash bytea`, `remember bool`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at null`, `revoke_reason text null`, `step_up_action null`, `step_up_target null`, `step_up_expires_at null`, `user_agent_summary varchar(80) null` | Unique `token_hash`. No IP address stored |
| `invitations` | `id uuid`, `code_hash bytea`, `note varchar(80) null`, `created_at`, `expires_at`, `max_uses int`, `uses int`, `revoked_at null` | Unique `code_hash` |

- **Cleanup.** An hourly hosted cleanup in the API deletes expired challenges and pending registrations, and sessions that expired or were revoked more than 30 days ago.
- **Display names** are trimmed, 1–60 characters, printable Unicode only (no control or format characters), and need not be unique.

## 5. The signed message

The server writes and stores the exact text. Lines end in LF (`\n`) with no trailing newline:

```text
{domain} wants you to sign in with your Ethereum account:
{address}

{statement}

URI: {uri}
Version: 1
Chain ID: 1
Nonce: {nonce}
Issued At: {issued}
Expiration Time: {expires}
```

**Fields:**
- `domain`: the host from the normalized origin, plus `:port` when the port is not the default. Every `http://` origin writes the scheme too, for example `http://100.123.45.42:5180`.
- `uri`: the origin followed by `/`.
- `address`: EIP-55 checksummed.
- `nonce`: 22 random base62 characters, at least 128 bits.
- `issued` and `expires`: UTC, `yyyy-MM-ddTHH:mm:ss.fffZ`. The lifetime is 5 minutes, accepted with 30 seconds of clock skew.

**Statements** (ASCII, one line):
- `sign-in`: `Sign in to Vessel. This is not a transaction and costs no gas.`
- `link`: `Link this wallet to the Vessel journal signed in with {sessionAddressEip55}. This is not a transaction.`
- `step-up`, action `wallet.link`: `Confirm adding a sign-in wallet to your Vessel journal. This is not a transaction.`
- `step-up`, action `wallet.remove`: `Confirm removing sign-in wallet {targetAddressEip55} from your Vessel journal. This is not a transaction.`

**Signing in the browser:** `personal_sign` with params `["0x" + hex(UTF-8 bytes of message), address]`.

**Verification:**
- The message is `keccak256("\x19Ethereum Signed Message:\n" + decimal byte length + bytes)` over the stored text. Recover the address from the signature and compare it as 20 bytes with the challenge address.
- A signature must be `0x` followed by 130 hex characters (65 bytes), with `r` and `s` in `[1, n-1]` and `v` in {0, 1, 27, 28}. A high `s` is normalized to low `s` with the recovery ID flipped, then accepted.
  - The ERC-6492 suffix, any other length, or another `v` → `signature-unsupported`.
  - A 65-byte signature that does not parse or recover → `signature-invalid`.
  - A signature that recovers another address → `signature-mismatch`.

## 6. HTTP API (Wallet mode)

In Token mode only `GET /api/auth/config` is mapped; every other `/api/auth/*` route answers 404. All responses are `no-store`.

**Errors** are ProblemDetails with a `code` extension:

| Status | Codes |
| --- | --- |
| 400 | `address-invalid`, `challenge-invalid`, `challenge-expired`, `signature-invalid`, `signature-unsupported`, `signature-mismatch`, `registration-invalid`, `display-name-invalid`, `label-invalid` |
| 401 | `session-required`, `session-expired`, `session-revoked`, `session-user-mismatch` |
| 403 | `origin-rejected`, `csrf-rejected`, `registration-closed`, `invitation-required`, `invitation-invalid`, `user-suspended`, `step-up-required` (with an `action` extension), `operator-required` |
| 404 | `not-found` |
| 409 | `wallet-taken`, `wallet-already-linked`, `last-wallet`, `revision-conflict` |
| 429 | `rate-limited`, with `Retry-After` |

### Public (A1)

| Endpoint | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/auth/config` | — | `{mode:"token"}` or `{mode:"wallet", registration:"closed"\|"invitation"\|"allow-list"\|"open", originAccepted:boolean}` | `registration` reports the effective, possibly gated, policy. Never returns the origin list |
| `POST /api/auth/challenge` | `{address}` | `{challengeId, message, expiresAt}` and the `__Host-vessel-signin` binding cookie (random, 10 min) | **Never reads users, wallets or the allow-list.** Purpose `sign-in` |
| `POST /api/auth/verify` | `{challengeId, signature, remember:boolean}` | `{status:"signed-in", session:SessionDto}` with the session cookie, **or** `{status:"registration-required", registration, requiresInvitation, expiresAt}` | Consumes the challenge in every outcome. Checks binding cookie, origin and purpose. Users, wallets and the allow-list are read **only after** a valid signature. Revokes the session of any session cookie sent with the request, and clears the binding cookie |
| `POST /api/auth/register` | `{registration, displayName, invitation?, remember}` | 201 `{session:SessionDto}` with the session cookie | One identity transaction: consume the pending registration (binding cookie required), re-check the policy, consume the invitation atomically, insert user (`member`, `active`), wallet and session |

### Session (A1 for session and sign-out, A2 for the rest)

| Endpoint | Request | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/auth/session` | — | `SessionDto` | The only authenticated route that does not require `X-Vessel-User` |
| `POST /api/auth/sign-out` | — | 204, clears the cookie | Revokes this session |
| `GET /api/auth/sessions` | — | `[{id, current, createdAt, lastSeenAt, remember, userAgent, walletAddress}]` | A2 |
| `DELETE /api/auth/sessions/{id}` | — | 204 | A2. Own sessions only; 404 otherwise |
| `POST /api/auth/sessions/revoke-others` | — | 204 | A2 |
| `PATCH /api/auth/profile` | `{displayName, expectedRevision}` | `UserDto` | A2 |
| `GET /api/auth/wallets` | — | `[{id, address, label, addedAt, lastUsedAt, current}]` | A2 |
| `POST /api/auth/step-up/challenge` | `{action:"wallet.link"\|"wallet.remove", target?:walletId, address}` | `{challengeId, message, expiresAt}` | A2. `address` must be one of this user's wallets |
| `POST /api/auth/step-up` | `{challengeId, signature}` | 204 | A2. Sets a single grant on this session (action and target, 5 min). It is consumed by the guarded call |
| `POST /api/auth/wallets/challenge` | `{address}` | `{challengeId, message, expiresAt}` | A2. Requires a `wallet.link` grant (otherwise 403 `step-up-required`). Does not check whether the address is linked anywhere |
| `POST /api/auth/wallets` | `{challengeId, signature, label?}` | 201 `WalletDto` | A2. Consumes the grant and serializes on the user row: `wallet-already-linked` (own) or `wallet-taken` (another user) |
| `PATCH /api/auth/wallets/{id}` | `{label}` | `WalletDto` | A2 |
| `DELETE /api/auth/wallets/{id}` | — | 204 | A2. Requires a `wallet.remove` grant for that ID, serializes on the user row, refuses the last wallet with `last-wallet`. Revokes the wallet's sessions, including the current one, whose cookie is then cleared |

**DTOs:**
- `SessionDto = {user: UserDto, wallet: {id, address, label}, session: {id, createdAt, idleExpiresAt, absoluteExpiresAt, remember}, adoptsLegacyPreferences: boolean}`
  - `adoptsLegacyPreferences` is true only for the user whose ID equals `Vessel:Auth:OwnerId`.
- `UserDto = {id, displayName, role:"member"|"operator", revision}`
- Addresses are returned EIP-55 checksummed.

**`GET /api/system`:** unchanged in shape. Its `owner` is the signed-in user.

## 7. Sessions, request guard and rate limits

### Sessions

- **Cookie.** The value is 32 random bytes in base64url; only their SHA-256 is stored. Attributes: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`. With "keep me signed in", `Max-Age` equals the absolute lifetime; otherwise it is a browser-session cookie.
- **Validation** reads the database on every request, with no cache in this version. The session must not be revoked or past its idle or absolute expiry, and its user must be active.
- **Idle refresh.** `last_seen_at` and the idle expiry are updated at most every 5 minutes.
- **Claims** are the same `NameIdentifier`, `Name` and authentication type as today, plus a `vessel:session` claim. `HttpJournalOwnerContext` stays unchanged.
- **Suspension** revokes every session of the user (`revoke_reason = suspended`).

### Tab binding

- Every cookie-authenticated request except `GET /api/auth/session` must send `X-Vessel-User: <user id>`.
- A missing header or a different user answers **401 `session-user-mismatch`**. The server never selects an owner from the header.

### Request guard

The guard applies to cookie-authenticated unsafe methods (POST, PUT, PATCH, DELETE) and to every public `/api/auth` POST:
- `Origin` must be present and match an accepted origin exactly.
- `Sec-Fetch-Site`, when present, must be `same-origin`.
- Public auth POSTs must also send `X-Vessel-Request: 1`. Authenticated requests already send `X-Vessel-User`, and either custom header forces a CORS preflight that Vessel never grants.
- There is no content-type rule, so multipart evidence uploads keep working. No CORS is configured.

### Streams

- The event stream and market streams call `IPrincipalValidity.StillValidAsync` before every poll or keepalive, at least every 15 s, and end the response when it turns false.
- `Vessel:Events:MaxStreams` caps event streams per process, beside the existing 4 per owner. A refusal answers 429 with `Retry-After: 5`.

### Rate limits

ASP.NET Core rate limiter, partitioned by client IP after forwarded headers (IPv6 grouped by /64):

| Endpoint | Per client | Global |
| --- | --- | --- |
| challenge | 10 per minute | 300 per minute |
| verify, register | 20 per minute | 600 per minute |
| register with invitation | 10 per hour | — |
| step-up and wallet link | 10 per 10 min, per session | — |

There are no per-wallet-address counters, so a valid signature is never refused because of someone else's traffic.

### Invitations

- A code holds 128 random bits, formatted as `VSL-` plus 26 Crockford base32 characters in groups of 5. The code is shown once by the CLI and stored as its SHA-256.
- Consumption is atomic: `UPDATE … SET uses = uses + 1 WHERE … AND uses < max_uses RETURNING`.

## 8. Offline commands (A1, A2)

They run as `dotnet Vessel.Api.dll identity <command>`, in the style of the evidence commands. Exit codes: 0 success, 1 error, 2 usage, 3 precondition failed. Output names IDs and counts, never secrets. Codes are printed only by `invite`.

| Command | PR | Effect |
| --- | --- | --- |
| `identity ensure-owner` | A1 | Creates the configured owner as user 1 (`operator`, `active`, `OwnerName`) if absent. Idempotent |
| `identity bind-wallet --user <guid> --address 0x… [--label]` | A1 | Attaches a wallet. Exit 3 if it belongs to another user |
| `identity invite [--note] [--expires 7d] [--max-uses 1]` | A1 | Prints the code once |
| `identity suspend --user` / `identity restore --user` | A2 | Suspend revokes all of the user's sessions |
| `identity promote --user` / `identity demote --user` | A2 | Refuses to demote the last active operator |
| `identity revoke-sessions --user <guid> \| --all` | A2 | |
| `identity reset-after-restore` | A2 | Revokes all sessions, deletes challenges and pending registrations, and prints a review table: users, roles, statuses, wallet counts and invitations still usable. **Mandatory before any host starts after a restore** |
| `identity verify` | A2 | Orphan check: journal owner IDs without a user, and users without wallets. Read-only |

## 9. Multi-owner backend (B1, B2)

### 9.1 Owner scopes (B1)

- **Implementation.** `IOwnerScopeFactory` is implemented in `Vessel.Persistence` and works in the API and worker hosts. The scope's `IJournalOwnerContext` returns the given owner, and reading it in a scope without an owner throws.
  - The API's request scopes keep `HttpJournalOwnerContext`.
  - One implementation serves both: an owner set by the factory wins, otherwise the HTTP principal is used.
- **No plain scope factories.** Every background scope uses the factory, at these sites:
  - `MonitorRegistration.cs:63-72` (renewals, including API-triggered Refresh);
  - `MonitorScheduler.cs:64,93,108`;
  - `SubscriptionMaintenanceService.cs:33,45`;
  - `EventSubscriptionListener.cs:47`;
  - `MonitorCommandListener.cs:23`;
  - `MessagingProvisioning.cs:90-95`.

  An architecture test forbids `IServiceScopeFactory` and `CreateAsyncScope` in `Vessel.Worker`, `Vessel.Messaging` and the monitor files, except in the factory itself.
- **Owner directory.** In Token mode the owner directory is `ConfiguredOwnerDirectory` everywhere (B1). In Wallet mode it is the identity implementation, registered by A1's `AddVesselIdentityDirectory()` in the API and worker.
- **Raw-SQL inventory.** An inventory test lists every raw-SQL site that intentionally lacks an owner predicate: `EvidenceCopyCommand.cs:66`, `EventStreamEpoch.cs:17`, and the new system stores. Any new site fails the test until it is reviewed.

### 9.2 Event subscriptions (B1)

This replaces the plan's options; it follows Opus's design. Sol is asked to verify it in round 2.

- **New table** `event_subscription_registrations (name pk, module, filters, fingerprint, registered_at)`. It is server-wide raw SQL outside the EF model, and the existing raw-SQL event tables stay. `event_subscriptions (owner_id, name)` keeps per-owner progress: responsible-from, low-water mark and status.
- **Provisioning** (insert-only, one transaction):
  1. Insert the registration, or verify its fingerprint as today.
  2. `INSERT … SELECT owner_id, name, sequence … FROM event_cursors ON CONFLICT DO NOTHING`. Every owner that already has events gets a progress row at its committed cursor.
- **A missing progress row** for a registered subscription means **responsible from the owner's first sequence**. Only the subscriber side (dispatcher, catch-up, low-water advance) creates the row, with `ON CONFLICT DO NOTHING`.
  - If the owner's `retention_floor` is above 0 at that moment, the row starts lagging, with an explicit gap up to the floor.
  - `NotResponsible` is valid only for sequences below an existing row's responsible-from, never for a missing row.
  - An owner whose first events commit while the provisioning transaction runs may receive events slightly older than the registration. That over-delivery is accepted and documented.
- **Catch-up** runs one cross-owner query per subscription to find owners with undelivered events, including owners in `event_cursors` without a progress row. It dispatches each owner's events in that owner's scope.
- **Listeners** check the message owner with `IJournalOwnerDirectory.StatusAsync`:
  - **Active:** dispatch in the owner's scope.
  - **Suspended:** acknowledge without dispatching or writing a receipt; catch-up delivers after restore.
  - **Unknown:** dead-letter.

  Monitor commands for a suspended owner are dropped and logged by ID; for an unknown owner they are dead-lettered.
- **Retention** iterates **every owner with retained data** (`event_cursors`), including suspended ones, in bounded pages.
- **Offline commands:**
  - `deregister-event-subscription <name>` is server-wide: registration, all progress rows and receipts, then the queue.
  - `retry-event-receipts` requires `--owner <guid>` or `--all-owners`.
- **The publisher side is unchanged.** Publishers never read or write subscription state.

### 9.3 Monitor (B2)

- **Leases.** `MonitorLease` and `MonitorCandidate` gain `OwnerId`.
- **Discovery** stays owner-scoped (the existing EF code) and iterates `ActiveOwnersAsync` pages.
- **Candidates** come from `ISystemMonitorStore.DueCandidatesAsync(limit)`: raw SQL across owners, **taking no locks**, returning `(OwnerId, AccountId, DueAt)` oldest first.
  - Owners are filtered through the directory, cached for one scheduler tick.
  - Owners that already hold their two leases are skipped, so the next owner gets a turn.
  - Each claim then runs in its owner's scope through the existing claim path, which re-checks with locks.
- **The owned-entity rule stays.** The `VesselDbContext` owner filter and the mixed-owner save guard are not weakened.
- **Lock order:** the owner budget lock `vessel-monitor-budget:{owner}`, then the venue lock `vessel-venue-budget:{venue}`. The order is the same in `MonitorCoordinator`, `ClaimAsync` and `ClaimDueAsync`.

### 9.4 Server state and venue limits (B2)

- **Server-state tables.** `server_monitor_heartbeats (deployment pk, seen_at)` and `server_venue_deadlines (venue_id pk, retry_after_until)` are ownerless tables accessed only by an `IServerStateStore` raw-SQL store, outside the EF model. The migration copies the latest per-owner deadline per venue, then drops `monitor_venue_budgets` and `monitor_heartbeats`.
- **Venue concurrency.** At most `VenueReadConcurrency` running reads per venue across all owners and processes, counted under the venue advisory lock. It sits beside the existing two reads per owner.
- **Venue deadlines** are honoured by monitor claims, account Refresh, account discovery and credential verification. A 429 from any of them records the venue deadline.
- **Per-user caps:**
  - market streams: at most 2 per user (8 per process stays);
  - candle `refresh=true`: one per user and series per 60 s;
  - account discovery and credential verification: 10 per user per minute.
- The Lighter static gates stay per process and are documented as such; they are not a server-wide guarantee.

### 9.5 Event stream revalidation (A1)

See §7. The stream endpoints get `IPrincipalValidity` from DI: `AlwaysValidPrincipal` in Token mode, and the session check in Wallet mode.

### 9.6 Suspension

| Effect | Behaviour |
| --- | --- |
| Sessions | Revoked; sign-in answers 403 `user-suspended` after a valid signature |
| Monitor | Discovery and claims are skipped; in-flight runs finish and settle normally |
| Events | Delivery is paused (no receipts written); retention continues; catch-up resumes after restore |
| Data | Retained unchanged |

## 10. Activation gate

- **A1 constant.** `IdentityRegistrationGate.MultiOwnerReady = false` forces the effective policy to `Closed`. `/api/auth/config` reports `closed`, and a log line at startup says registration is gated. **B2 sets it to `true`.**
- **Wallet mode is not advertised** in release notes or the deploy README until P4 has verified:
  - the isolation suite;
  - two-owner worker and event tests;
  - revocation of open streams;
  - HTTPS cookies;
  - the restore reset;
  - a real-wallet compatibility check.

## 11. Frontend (D1)

### Gate

- `api/auth.ts` holds the endpoints, guards and the code-to-copy map. `features/identity/*` holds the UI.
- `WorkspacePage` first calls `GET /api/auth/config`:
  - `token`: the existing `ConnectionGate`, unchanged;
  - `wallet`: `SignInGate`, which calls `GET /api/auth/session`. A 200 goes to the shell, a 401 to sign-in.

### Transport

- `createApiCall` takes `{kind:"bearer", token}` or `{kind:"session", userId}`.
- A session request uses `credentials:"same-origin"` and `X-Vessel-User`. Public auth POSTs send `X-Vessel-Request: 1`. Bearer requests keep `credentials:"omit"`.

### Status handling

- **A 401 is forced teardown.** Show "Your session ended", then `location.replace` to the sign-in, with no confirmation and no discard guard.
- **403 by code:**
  - `step-up-required` opens the step-up dialog and retries once;
  - `user-suspended` opens a suspended screen;
  - other codes show their message.
- **Voluntary sign-out** keeps today's unsaved-Play confirmation, then sign-out and a full reload.

### Cross-tab

- `BroadcastChannel("vessel-session")` posts `{type:"signed-in"|"signed-out", userId}`.
- A tab whose user differs from the message reloads, showing "Signed in as someone else in another tab".
- A generation counter discards stale responses, so stale failures and sign-outs never end a newer session.

### Wallet adapter

- **Discovery.** EIP-6963 discovery. If nothing is announced within 500 ms and `window.ethereum` exists, list a "Browser wallet" fallback.
- **Metadata** is untrusted:
  - name up to 40 characters;
  - icon only as `data:image/(png|jpeg|webp|svg+xml)` up to 64 KB, rendered with `<img>`;
  - `rdns` is never used for trust.
- **Last used.** The last-used `rdns` is stored in `vessel:device:last-wallet`.
- **Methods.** It calls only `eth_requestAccounts` and `personal_sign`, and listens to `accountsChanged` and `disconnect`. A changed account during signing shows the "wallet switched account" state.

### Preferences

- `vessel:u:{userId}:appearance` and `vessel:u:{userId}:chart.preferences.v1`.
- `vessel:device:theme` holds the last theme ID for the sign-in screen.
- When `adoptsLegacyPreferences` is true, the legacy keys are copied to the user's keys, then deleted.
- The in-memory stores load the user's keys after sign-in; a user change always reloads the page.

### Screens and copy

- **Screens** follow `prototype/wallet-sign-in.html`, with these changes:
  - "keep me signed in on this device" on the Sign step;
  - no "Domain matches this page" tick;
  - unsupported signatures get the generic copy "This signature format isn't supported yet. Use a regular wallet address.";
  - the "unreachable" state no longer promises that nothing was signed.
- **Copy.** Statements that Vessel never signs anything become: "Vessel never signs, sends or approves anything at a venue."
- **No CSP change and no new runtime dependency.** `@noble/curves` and `@noble/hashes` are allowed as dev dependencies, for test signing only.

## 12. Tests required

- **A:**
  - Golden message-byte tests per purpose and origin form.
  - Signature vectors made with `EthECKey`: `v` 0/1/27/28, high `s`, the 6492 suffix, wrong length, wrong address.
  - Challenge single use, expiry and skew, binding cookie, origin; registration races (same wallet twice); invitation exhaustion under concurrency.
  - Request guard (missing or foreign `Origin`, `Sec-Fetch-Site: cross-site`, missing headers, multipart allowed); tab-binding mismatch.
  - Rate-limit partitions, session idle and absolute expiry, remember, suspension, stream revalidation ending an open stream.
  - Bootstrap and CLI exit codes, `reset-after-restore`.
  - Identity tests use an isolated `Vessel:Identity:Schema`.
- **B:**
  - Two owners: scheduler claims, fairness, a renewal after more than 1 minute in the owner's scope.
  - Events: the first event of a new owner reaches a provisioned subscription; concurrent first events; provisioning backfill; an owner created after provisioning; suspended pause and resume; retention for a suspended owner; deregistration.
  - Server-wide venue deadline across two owners; `WorkerConcurrency`.
  - The architecture test for scope factories, and the raw-SQL inventory.
- **C:**
  - A test-only authentication scheme selecting the owner.
  - An endpoint inventory from `EndpointDataSource`: every route is covered or explicitly exempted.
  - A foreign ID and a nonexistent ID give identical 404 bodies.
  - Foreign IDs in route, query, body and bulk payloads, with post-mutation state assertions.
  - Identical native venue identities and source fill IDs in both owners: Overview, Activity, Review and Sizing results stay separate.
  - Evidence bytes, credential associated data, diary request IDs reused across owners, and event streams and cursors.
  - Concurrent requests for two owners.
- **D:**
  - Vitest for the adapter (discovery, fallback, metadata bounds, stale results), the sign-in state machine, transport headers, the 401/403 mapping, cross-tab handling and preference migration.
  - A Playwright smoke with an injected EIP-6963 provider signing through a page-exposed Node signer (`@noble/curves`) is required in P4.

## 13. Out of scope

- WalletConnect, smart-contract wallets and an RPC endpoint;
- the operator page, user or journal deletion and export, passkeys, recovery codes;
- per-user quotas (accounts, evidence bytes), required before `AllowList` or `Open` registration is advertised;
- server-side preferences;
- deployment to or migration of the owner's installation.
