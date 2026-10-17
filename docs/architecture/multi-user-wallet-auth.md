# Users and wallet sign-in: analysis and plan

October 17, 2026. Status: **analysis and draft plan for owner decisions. Nothing here is authorized for implementation.**

The owner asked what it would take to replace the shared API token with users who register and sign in with an EVM wallet, through a separate frontend and backend module, possibly with WalletConnect. Each user gets their own portfolios, accounts, Plays and everything else. The user connects a wallet and signs a message, and the backend verifies the signature and finds or creates the user. The owner also asked for the wallet selector and related screens to be added to the design.

The design proposal is in [`docs/design/wallet-sign-in/`](../design/wallet-sign-in/README.md), with the disposable page `prototype/wallet-sign-in.html`.

**October 17 update:** the owner asked to start orchestrating the work with Opus and Sol agents. Both round-1 reviews returned "go with changes". Their corrections are in the [delivery contract](multi-user-delivery-contract.md), which supersedes this analysis wherever they differ. Among them:
- a subscriber-side subscription algorithm;
- owner scopes for every background scope;
- a phase for wallet, session and step-up endpoints;
- tab binding with `X-Vessel-User`;
- revalidation of open streams;
- a reset step after restore;
- a second migration bundle and an `ensure-owner` step;
- "keep me signed in" instead of one long default session;
- 128-bit invitation codes.

## Summary

- **Most of the data separation already exists.** Every journal entity is owner-scoped. `VesselDbContext` filters every query by owner and refuses saves that change an owner. Composite foreign keys stop cross-owner links, credential encryption binds the owner, and evidence keys start with the owner. A user can therefore be a journal owner: **the user ID is the owner ID**. Portfolios, accounts and Plays need no data-model change. The audit found no unique index that two users would collide on. The same Hyperliquid address, Lighter index or RISEx address, the same fill, order and funding IDs, and the same portfolio names can already exist under different owners, and existing PostgreSQL tests prove it.
- **The real work is in four places:**
  1. A new identity module: users, sign-in wallets, sign-in challenges, sessions and invitations.
  2. Removing the "one configured owner" assumption from authentication, the worker, messaging, offline commands and a few limits that should be server-wide.
  3. A new frontend sign-in module, with wallet discovery that loads only on the sign-in screen.
  4. Deployment changes: the public origin, cookies, CSP and migrating the existing installation.
- **Recommended protocol:** Sign-In with Ethereum ([EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)). The server writes the whole message and keeps a single-use nonce. The wallet signs with `personal_sign` (EIP-191), and the server recovers the address. After that the browser holds a server-side session in an HttpOnly cookie, not a token.
- **Recommended wallet stack:**
  - **First version:** browser and in-app wallets discovered with EIP-6963, behind Vessel's own selector. This needs no new dependency and contacts no third party.
  - **WalletConnect later, only after a licence review.** Since September 2025 its packages carry the WalletConnect Community License: a commercial licence above 500 monthly users, a mandatory Reown network, and modifications assigned to Reown.
  - If it is approved, it runs headless with Vessel's own QR, through wagmi 3 or the provider directly, and only when the operator configures a project ID.
  - No vendor modal (AppKit, RainbowKit, ConnectKit) and no hosted identity (Privy, Dynamic).
- **Size:** four pull requests (phases 1–4) after the owner's decisions (see [Plan](#plan)). The first three phases give a working multi-user server. WalletConnect, operator screens, smart-contract wallets and journal deletion come later, each separately authorized.

## Terms

Proposed additions to [`CONTEXT.md`](../../CONTEXT.md), to be added once the owner agrees. "Account" stays the venue account; never call a user an account.

| Term | Meaning | Avoid |
| --- | --- | --- |
| **User** | A person who signs in to a Vessel server. Each user owns exactly one journal; the user ID is the journal owner ID. | User account, account |
| **Sign-in wallet** | An EVM address that proves who a user is. Linking one does not import its trading history, even when the same address is also a venue source identity. | Account, source identity, venue wallet |
| **Session** | A server-side record of one signed-in browser, revocable from Settings. | Token |
| **Invitation** | A single-use code from the operator that lets a new wallet create a journal on an invite-only server. | |
| **Operator** | Whoever runs the server. They configure registration and manage users, but never see inside a journal. | Admin of journals, owner |

## Where Vessel starts from

### Already in place

| Mechanism | Where | What it gives multi-user |
| --- | --- | --- |
| Owner context | `IJournalOwnerContext` (`Application/Ownership`), filled from authenticated claims by `HttpJournalOwnerContext` | Application services already take the owner from authentication, never from a request body |
| Owned entities | Every mapped entity implements `IOwned`; model building fails otherwise | New tables cannot forget the owner |
| Query filters and save checks | `VesselDbContext` | One user's queries cannot see another user's rows; a save cannot move a row to another owner |
| Composite owner foreign keys | Persistence configurations | A Play cannot link to another owner's account or order |
| Credential vault | AES-GCM associated data `vessel:credential:v1\|{ownerId}\|{accountId}\|{purpose}` | A sealed Lighter token cannot be opened for another user |
| Evidence keys | `owner/play/image.ext` | Object storage is already partitioned |
| Event cursors, cooldowns, stream limits | Per-owner rows and counters | Event streams, Check cooldowns and the four-stream limit already separate users |
| SSE over `fetch` | `api/request.ts`, `useMonitorEvents.ts` | No `EventSource`, so moving from a header to a cookie is simple |

### Single-owner assumptions to remove

From the October 17 audit of `backend/src`. Every 1:N relation below currently resolves to the single owner in `Vessel:Auth:OwnerId`.

| Area | Today | Breaks with several users because |
| --- | --- | --- |
| Authentication | `BearerTokenHandler` compares one configured token and issues the configured `OwnerId` and `OwnerName`; `ProductionConfiguration` requires that token | There is no user, no per-user credential and no list of owners. **No users or owners table exists.** An owner is only a GUID column. |
| Worker owner | `Vessel.Worker/Program.cs` registers a singleton `WorkerOwnerContext` from configuration | Every scope the worker opens sees one owner |
| Monitor discovery and claims | `MonitorCoordinator` and `MonitorStore.DiscoveryCandidatesAsync` / `ClaimDueAsync` filter by the current owner; `MonitorLease` and `MonitorCandidate` carry no `OwnerId` | Other users' Plays are never checked |
| Monitor heartbeat | `monitor_heartbeats` keyed by owner, written for the configured owner | Every other user would see the worker as offline |
| Venue budget | `monitor_venue_budgets` keyed by owner and venue | A venue 429 for one user does not slow the others, though all share the server's IP |
| Read capacity | Advisory lock `vessel-monitor-budget:{owner}`, two running reads per owner; the comment and a test call it global | N users allow 2N concurrent venue reads |
| Messaging hosts | `MessagingHost` takes the configured owner. `EventSubscriptionListener` and `MonitorCommandListener` dead-letter any message for another owner | Other users' events and Check commands are rejected |
| Event subscriptions | `provision-messaging` registers subscriptions for the configured owner only. For other owners `EventDispatcher.ResponsibleAsync` answers *not responsible*, and that outcome is **acknowledged, not dead-lettered** | **New users' events would silently never reach any subscriber** |
| Catch-up and retention | `EventCatchUp` and `EventRetention` run for the current owner from `SubscriptionMaintenanceService` | Other users get no catch-up, and their events are never pruned |
| Offline commands | `deregister-event-subscription` and `retry-event-receipts` act on the configured owner. `deregister` also deletes the shared queue | They must act per owner or across owners. `rotate-event-epoch`, `evidence-copy-to-*` and `migrate` already cover every owner |
| Live market streams | `MarketStreamLimiter`: 8 streams per process, no per-user cap | One user can take all 8 |
| Candle refresh | `refresh=true` bypasses the shared candle cache | Any user can force upstream reloads that every user pays for in rate limits |
| Duplicate venue accounts | Each journal has its own copy of an account | N journals following one address make N monitor reads |
| Rate limiting | Only `AuthFailureLimiter`, built around one secret ("the right token always works"); no ASP.NET rate limiter | Sign-in endpoints need their own limits |

Fine as they are:
- per-owner event cursors, the four-streams-per-owner limit and per-account cooldowns;
- database row locks and advisory locks keyed by owner or entity;
- public candle, catalogue and market-context caches, which check ownership before the cache;
- the shared Hyperliquid WebSocket and the Lighter gates, which protect the venue globally.

Two small integrity gaps are worth closing in passing: `monitor_exit_watches` references links by `LinkId` alone, and `play_order_links.AccountId` has no foreign key.

**Keep the owner GUID.** Credential associated data binds the owner ID, so moving existing rows to a new user ID would make every saved Lighter token undecryptable. The existing owner GUID must become the first user's ID (D2).

### Frontend today

- `features/connection/ConnectionGate.tsx` asks for the API token. It keeps the token in a closure, calls `GET /api/system`, and passes `(system, disconnect, api)` to the shell. Reloading the page signs the user out.
- `api/request.ts` sends `Authorization: Bearer` with `credentials: 'omit'`. A cookie session needs `credentials: 'same-origin'`.
- A 401 during a session only clears the candle cache. Nothing returns to the sign-in screen, and the monitor stream keeps retrying.
- Disconnect is split between the shell (Play guard, refresh queue, monitor) and the gate (candle cache, state).
- `localStorage` holds `vessel.appearance` and `vessel.chart.preferences.v1` under global keys. On a shared browser, the next user would inherit the previous user's themes and chart settings.
- No web3 dependency exists, and the CSP allows `connect-src 'self'` only.
- Copy that says Vessel "never signs anything" must be reworded. It still never signs or sends anything at a venue, but signing in is a wallet signature. Affected places: `frontend-guide.md`, `mvp-alignment.md`, Settings "Orders and signing: Not enabled", and the Lighter token tip.

## Decisions for the owner

Each decision has a recommendation; none is settled.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Who may create a journal | Closed (operator command only) · Invitation only · Allow-list of addresses · Open | **Invitation only** by default, configurable. Open registration on an internet-facing server invites abuse: storage, venue rate limits and monitor work all grow per user. |
| D2 | The existing installation | Bind a wallet to the configured owner with an offline command · claim in the browser by presenting the current API token plus a wallet signature once · first wallet to sign in claims it | **Offline command** `identity bind-wallet --owner <guid> --address 0x…`. It is explicit, needs host access, and keeps every existing row because the user ID stays the configured owner GUID. That user also becomes the first operator.<br>The token-plus-signature claim is a friendlier alternative during the transition release. "First wallet wins" is a race on any exposed server. |
| D3 | The shared API token | Remove · keep as a mode (`Vessel:Auth:Mode = Token \| Wallet`) for a transition · keep for automation | **Keep `Token` as a mode for one release**, default `Token`, so upgrades don't lock anyone out. Switch the default to `Wallet` after verification, then remove it. Machine access later gets per-user tokens, not the shared one. |
| D4 | WalletConnect | Never · optional when a project ID is configured · always | **Not in the first version; optional later after a licence review.**<br>• Packages from 2.21.9 (September 2025) use the WalletConnect Community License: Reown network required, a commercial licence above 500 monthly users or 2.5M RPC calls, modifications assigned to Reown, terms changeable. Pinning 2.21.8 (Apache-2.0) would freeze security fixes.<br>• When enabled, the relay learns the client IP, project ID and timing; payloads are end-to-end encrypted. Reown's policy lists the full wallet address.<br>• LAN and tailnet origins show as "Cannot verify" in wallets, and the CSP must allow it (see [Security headers](#security-headers)). |
| D5 | Smart-contract wallets (Safe, smart accounts) | Externally owned accounts only · add EIP-1271/ERC-6492 through a configured RPC | **Externally owned accounts only at first**, with a clear message. Verifying contract signatures needs an Ethereum RPC endpoint per chain, which Vessel does not have today. |
| D6 | Several wallets per user | One · many | **Many in the schema from the start**, with the Link wallet screen in phase 3. One lost wallet must not mean a lost journal. |
| D7 | Operator screens | Offline commands only · Users & invitations page | **Commands first**, page later. The page manages access only; it must never show another user's journal. |
| D8 | Staying signed in | Session ends at reload (today) · OWASP-style short session (15–30 min idle, 4–8 h absolute) · long persistent session | **Persistent but configurable:** 14 days idle, 30 days absolute, rotated on sign-in, revocable. Vessel cannot move funds, and sensitive actions ask for a fresh signature (see [step-up](#step-up-signatures)). Unsaved Play drafts are still lost on reload, as today. |
| D9 | The same venue account in two journals | Allowed (each journal keeps its own copy) · one journal only | **Allowed.** Two people can legitimately follow one address (for example a shared vault). Keep the copies independent. Venue rate limits then need a server-wide budget, because both journals read through one server IP. |
| D10 | Per-user browser preferences | Keys namespaced by user · stored on the server | **Namespace by user ID now**, server-side preferences later if wanted. Built-in theme selection stays local. |
| D11 | Leaving | Not offered · delete journal with confirmation · export first | **Later phase.** Deletion must purge every owned table and evidence object, and must be confirmed by a fresh signature. |
| D12 | Chain shown in the message | Fixed `Chain ID: 1` · the wallet's current chain | **Fixed `Chain ID: 1`** while only regular wallets are supported. For them the chain has no cryptographic effect, and the wallet is never asked to switch networks. Smart-contract wallets (D5) verify on the chain in the message (Coinbase Smart Wallet on Base, 8453), so revisit this together with D5. |

## Proposed design

### Sign-in sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser (identity module)
    participant W as Wallet (EIP-6963 or WalletConnect)
    participant A as API (identity module)
    participant D as PostgreSQL (identity schema)
    U->>B: Choose a wallet
    B->>W: eth_requestAccounts
    W-->>B: 0xAddress (and chain)
    B->>A: POST /api/auth/challenge {address, chainId}
    A->>D: store nonce hash, address, origin, message hash, expiry (5 min)
    A-->>B: {challengeId, message}
    B->>W: personal_sign(message)
    W-->>U: Shows the message
    U->>W: Sign
    W-->>B: signature
    B->>A: POST /api/auth/verify {challengeId, signature}
    A->>D: consume challenge (single use, not expired)
    A->>A: recover address from signature, compare
    alt wallet linked to an active user
        A->>D: create session
        A-->>B: 200 {user} + Set-Cookie session
    else unknown wallet
        A->>D: pending registration (10 min) bound to the address
        A-->>B: 200 {status: "registration-required", registration, requiresInvitation}
        U->>B: Display name (+ invitation code)
        B->>A: POST /api/auth/register {registration, displayName, invitation?}
        A->>D: create user, wallet, session; consume invitation
        A-->>B: 201 {user} + Set-Cookie session
    end
```

### The message

The server writes the whole message and stores its hash. The browser only displays it and asks the wallet to sign. Nothing is parsed from client input, so there is no ambiguity about which fields were signed.

```text
vessel.example.net wants you to sign in with your Ethereum account:
0x7A3f9C2e5b1D4a8F0c6E2b9D3a7F1e5C8b2D4caa

Sign in to Vessel. This is not a transaction and costs no gas.

URI: https://vessel.example.net/
Version: 1
Chain ID: 1
Nonce: 9fK2mQ7xLp3Rt8VwA4cHs1
Issued At: 2026-10-17T09:41:12.000Z
Expiration Time: 2026-10-17T09:46:12.000Z
```

- **Domain and URI** come from the request `Origin`, accepted only if it is in `Vessel:Identity:Origins`. Wallets compare the domain with the page, so a LAN address and a tailnet hostname are both listed. The `Host` header is never trusted.
- **Plain HTTP.** Without a scheme, wallets assume `https` on the default port. A plain-HTTP origin must therefore write the scheme and port into the first line, as in `http://100.123.45.42:5180 wants you to sign in…`.
- **Address:** EIP-55 checksummed in the message; the browser's lower-case form is accepted, and addresses are compared as 20-byte values.
- **The statement differs by purpose.** Sign-in uses the text above. Linking uses "Link this wallet to the Vessel journal of {name}." and step-up uses "Confirm {action} in Vessel." The challenge stores its purpose, so a signature for one purpose is useless for another. Statements are ASCII on one line, as the grammar requires.
- **Nonce:** at least 96 random bits, letters and digits only (EIP-4361 forbids `-` and `_`, so not base64url). Only its hash is stored.
- **Lifetime:** 5 minutes, with `Expiration Time` in the message, enforced by the server with a small clock-skew allowance, and shown as a countdown.
- **Login CSRF.** The challenge is also bound to a short-lived pre-login HttpOnly cookie. Without it, a page could not complete a sign-in on someone else's behalf.
- **No resources and no `Not Before`.** These fields are not needed.

### Server verification

1. The challenge exists, has the same purpose, is unexpired and unconsumed, and matches the pre-login cookie. It is consumed atomically (`UPDATE … WHERE consumed_at IS NULL RETURNING`), whatever the outcome.
2. The request `Origin` equals the challenge origin.
3. The signature is 65 bytes. Recover the public key from the EIP-191 hash of the stored message (`keccak256("\x19Ethereum Signed Message:\n" + byte length + bytes)`), with `v` normalized from 27/28 and low-`s` enforced. The derived address must equal the challenge address.
4. Smart-contract wallets end in the `smart-wallet-unsupported` code. They show up as a signature that is not 65 bytes, ends in the ERC-6492 `0x6492…` magic suffix, or recovers to another address. Coinbase Smart Wallet/Base Account and Safe sign this way (D5).
5. Any other mismatch answers `signature-invalid`.
6. Rate-limit challenges and verifications per client address (the already-trusted forwarded IP) and per wallet address with the ASP.NET Core rate limiter. Cap open challenges per address.

**Library:** Nethereum.Signer 7.0.0 (MIT; net8/9/10; depends on BouncyCastle.Cryptography and NBitcoin.Secp256k1), behind an Application port `IWalletSignatureVerifier`. Use `EthereumMessageSigner.EncodeUTF8AndEcRecover` for recovery and `AddressUtil` for EIP-55.
- **Do not use Nethereum.Siwe.** It pulls in Nethereum.Web3 and Newtonsoft.Json, never checks domain, URI or chain, parses times with `DateTime.Now` and no skew, and its in-memory nonce store never expires entries.
- **If ever hand-rolled** (NBitcoin.Secp256k1 alone): .NET's `SHA3_256` is FIPS-202 SHA-3, not Ethereum's Keccak-256, and gives wrong hashes.
- **Smart-contract wallets later** (D5) need operator-configured RPC endpoints per chain for ERC-1271 `isValidSignature` and ERC-6492 simulation through `eth_call`. Nethereum's services can do both.

### Step-up signatures

Domain binding stops a signature made for another site from being replayed against Vessel. It cannot stop a live relay, where a phishing page shows a real Vessel message and forwards the signature. The October 17 research found only MetaMask and Phantom enforce the domain check; Coinbase, Trust, OKX and others display it without checking.

The mitigations are short challenges, a visible session list with revocation, and a fresh signature from an already linked wallet before sensitive actions:
- linking or removing a sign-in wallet;
- saving a venue read-only token;
- deleting accounts with retained history, or the journal itself;
- operator actions.

The step-up challenge uses the `step-up` purpose and names the action. The proof is valid for 5 minutes in that session only.

### Sessions and cookies

- **The cookie.** After verification the API creates a `sessions` row and sets `__Host-vessel-session`: HttpOnly, Secure, SameSite=Strict, Path=/, no Domain. Strict works because every API call is same-origin through nginx. Only the SHA-256 of the 256-bit random value is stored, and a new value is issued at every sign-in.
- **The handler.** A new `VesselSession` authentication handler reads the cookie, then loads the session and user, with a short in-memory cache keyed by the session hash. It checks that the user is active and the session is unexpired and unrevoked, then issues the same claims `BearerTokenHandler` issues today. `HttpJournalOwnerContext` and every service stay unchanged.
  - The alternative is ASP.NET Core cookie authentication with a PostgreSQL `ITicketStore`. In .NET 10 it answers 401/403 instead of redirecting for API endpoints.
- **Bound to the wallet.** A session records the wallet that created it. Removing that wallet revokes its sessions.
- **Expiry:** idle 14 days, absolute 30 days (D8). The handler updates `last_seen_at` at most every 5 minutes. Sign-out revokes the row, and Settings can revoke the other sessions.
- **CSRF.** .NET 10 antiforgery covers forms only; automatic `Sec-Fetch-Site` checks arrive in ASP.NET Core 11. Vessel therefore adds middleware for unsafe methods. Such a request must carry:
  - `Sec-Fetch-Site: same-origin`, or otherwise an `Origin` exactly in `Vessel:Identity:Origins` (a `null` or missing origin is refused);
  - a JSON content type where there is a body;
  - the header `X-Vessel-Request: 1`.

  No CORS is configured. GETs never change state, which is already true.
- **Plain HTTP:** `__Host-` and `Secure` cookies need HTTPS, except on localhost. As with the October 12 credential exception, the API in Development may use `vessel-session` without `Secure` for LAN preview. Other environments refuse to start in `Wallet` mode unless every configured origin is `https://` or loopback.
- **Fallback policy:** unchanged. Every endpoint stays private unless it opts out, and only `/api/auth/config`, `/challenge`, `/verify` and `/register` opt out.

### Registration and invitations

- `Vessel:Identity:Registration = Closed | Invitation | AllowList | Open` (D1), default `Invitation`.
- Invitations are random codes (`VSL-XXXX-XXXX`, about 40 bits, with 25 attempts per hour per client address). Only their hash is stored, with an expiry, a use count and limit, an optional note and the creating operator.
- A pending registration exists only after a valid signature. It lasts 10 minutes, belongs to one address and is single-use. Display names are trimmed, 1–60 characters, and need not be unique.
- If two journals race to claim one wallet, the unique index on the wallet address decides.

### Identity data model

A separate `identity` PostgreSQL schema with its own `IdentityDbContext` and migrations, applied by the same explicit `migrate` command. These tables define owners and are not `IOwned`, so they must never go through the journal query filters.

| Table | Columns (main) | Notes |
| --- | --- | --- |
| `users` | `id` (= owner ID), `display_name`, `status` (`active`, `suspended`), `role` (`member`, `operator`), `created_at`, `last_seen_at`, `revision` | The existing configured owner GUID becomes a row (D2) |
| `user_wallets` | `id`, `user_id`, `address` (lower-case, unique across the server), `label`, `added_at`, `last_used_at` | Cannot delete a user's last wallet |
| `auth_challenges` | `id`, `purpose` (`sign-in`, `link`, `step-up`), `action` (step-up only), `address`, `user_id` (link and step-up), `origin`, `chain_id`, `nonce_hash`, `message_hash`, `binding_hash` (pre-login cookie), `issued_at`, `expires_at`, `consumed_at` | Pruned hourly once expired |
| `pending_registrations` | `id`, `address`, `token_hash`, `expires_at`, `consumed_at` | |
| `sessions` | `id`, `user_id`, `wallet_id`, `token_hash` (unique), `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `step_up_action`, `step_up_until`, `user_agent_summary` | No IP address stored, by default; removing the wallet revokes its sessions |
| `invitations` | `id`, `code_hash`, `note`, `created_by`, `created_at`, `expires_at`, `max_uses`, `uses`, `revoked_at` | |

### Backend module

```text
backend/src/Vessel.Identity/          new project (like Vessel.Messaging)
  Domain/        User, UserWallet, Session, AuthChallenge, Invitation (pure rules)
  Application/   SignInService, RegistrationService, WalletLinkService, SessionService, InvitationService,
                 ports IIdentityStore, IWalletSignatureVerifier, ISiweMessageFactory
  Persistence/   IdentityDbContext (schema identity), stores, migrations
  Infrastructure/ NethereumSignatureVerifier, SessionAuthenticationHandler, CSRF filter, options
  IdentityEndpoints.cs, AddVesselIdentity(), MapIdentityEndpoints()
```

- `Vessel.Api` references `Vessel.Identity` and calls `AddVesselIdentity()` / `MapIdentityEndpoints()`. Feature projects never reference it.
- The rest of the backend sees only two ports, both in `Application/Ownership`:
  - `IJournalOwnerContext`: unchanged.
  - A new `IJournalOwnerDirectory`: lists active owners and checks one, for the worker and messaging.
- `ArchitectureTests` gains rules: Domain, Application, Persistence and Infrastructure never reference `Vessel.Identity`, and `Vessel.Identity` never references journal persistence.
- The existing single project layout stays. Keeping identity in its own project matches the owner's "separate module" request, and it can be removed or replaced (passkeys, OIDC) without touching the journal.

### API

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/auth/config` | public | Mode, registration policy, whether WalletConnect is enabled and its project ID (public by design), accepted origins check |
| `POST /api/auth/challenge` | public | `{address, chainId}` → `{challengeId, message, expiresAt}` |
| `POST /api/auth/verify` | public | `{challengeId, signature}` → session cookie and `{user}`, or `{status: "registration-required", registration, requiresInvitation}` |
| `POST /api/auth/register` | public | `{registration, displayName, invitation?}` → 201, session cookie |
| `GET /api/auth/session` | session | Current user, wallet used, session expiry, role |
| `POST /api/auth/sign-out` | session | Revoke this session |
| `GET /api/auth/sessions`, `DELETE /api/auth/sessions/{id}`, `POST /api/auth/sessions/revoke-others` | session | Sessions in Settings |
| `POST /api/auth/step-up/challenge`, `POST /api/auth/step-up` | session | Fresh signature from a linked wallet for a named sensitive action |
| `GET /api/auth/wallets`, `POST /api/auth/wallets/challenge`, `POST /api/auth/wallets`, `PATCH`/`DELETE /api/auth/wallets/{id}` | session (+ step-up for link and remove) | Link (step-up from a linked wallet, then a signature from the new one), label and remove wallets |
| `PATCH /api/auth/profile` | session | Display name |
| `/api/operator/invitations`, `/api/operator/users` | operator role | Later phase (D7) |

- Errors are ProblemDetails with a stable `code`, and the browser owns the wording, as the credential screens do today. The codes are `challenge-expired`, `challenge-used`, `origin-mismatch`, `signature-invalid`, `address-mismatch`, `registration-closed`, `invitation-required`, `invitation-invalid`, `wallet-linked-elsewhere`, `last-wallet`, `user-suspended` and `rate-limited` (429 with `Retry-After`).
- `GET /api/system` stays, and its `owner` becomes the signed-in user.

### Multi-owner changes in the rest of the backend

No journal table changes. The changes are in who decides the owner outside an HTTP request.

1. **Owner scopes.** Replace the worker's singleton `WorkerOwnerContext` with a scoped, settable owner context, set once per scope from a validated owner (`IOwnerScopeFactory.CreateScope(ownerId)`). Setting it twice or using it unset throws, as the HTTP context throws today. The `VesselDbContext` save guard already refuses mixed owners in one context, so every cross-owner job uses one scope per owner.
2. **Owner directory.** `IJournalOwnerDirectory` (identity module) lists active owners and answers `IsActive(ownerId)`. In `Token` mode it returns the configured owner, so one code path serves both modes.
3. **Monitor.**
   - Discovery and `ClaimDueAsync` become a cross-owner claim: raw SQL over `accounts` without the owner predicate, returning `(OwnerId, AccountId)`. Only active owners are claimed, with fair ordering (oldest due first, at most two leases per owner).
   - Each run, renewal and settlement then runs in that owner's scope.
   - `MonitorLease` and `MonitorCandidate` gain `OwnerId`.
4. **Server-wide venue budget.**
   - `monitor_venue_budgets` becomes keyed by venue alone: one `Retry-After` deadline for the server.
   - The per-owner read capacity stays as fairness, beside a new per-venue server-wide cap (`Vessel:Monitor:VenueReadConcurrency`, default 4).
   - The heartbeat becomes per worker deployment, not per owner.
   - API Refresh observes the same venue deadline.
5. **Messaging.**
   - Listeners stop comparing message owners with configuration. They check `IsActive(message.OwnerId)` and dispatch in that owner's scope. Unknown or suspended owners dead-letter, as foreign owners do today.
   - Subscriptions become **server-wide registrations with per-owner low-water marks**. A subscription row is created lazily for an owner on that owner's first event, inside the same unit of work.
   - Alternatively, `register user` inserts the rows for every provisioned subscription. In either design, "not responsible" must never silently swallow a new owner's events.
   - Catch-up and retention iterate active owners from the directory.
6. **Offline commands.** `retry-event-receipts` and `deregister-event-subscription` take `--owner <guid>` or `--all-owners`. The shared queue is deleted only when no owner remains registered.
7. **Per-user caps.** Market streams: at most 2 per user within the 8 per process. `refresh=true` on candles: cooldown per user and series. Event SSE polling grows with users; switching to PostgreSQL `LISTEN/NOTIFY` is a later optimization, not a requirement.
8. **Tests.** Update the tests that encode one owner (`WorkerHostTests` 89–106, `MonitorPostgresTests` 405 and 523, `ApiTests` 146/158, `ProductionHardeningTests` 17). Add two-owner scheduler, catch-up, retention and subscription-delivery tests; none exist today.

### Frontend module

```text
frontend/src/api/identity.ts                 auth endpoints, guards, error codes → copy
frontend/src/features/identity/
  SignInGate.tsx                             replaces ConnectionGate (same render-prop contract)
  SignInCard.tsx, WalletList.tsx, SignMessageStep.tsx, CreateJournalStep.tsx, StepUpDialog.tsx
  signInMachine.ts                           explicit states: choose → connecting → signing → verifying → registering | error
  wallets/discovery.ts                       EIP-6963 store (requestProvider / announceProvider)
  wallets/walletconnect.ts, WalletConnectPanel.tsx   later (D4): lazy, only when /api/auth/config enables it
  AccountMenu.tsx                            sidebar owner card menu
  ProfileSettings.tsx, LinkWalletDialog.tsx, SessionsList.tsx
  identity.css
```

- **Loading.** The sign-in screen is the first screen, so it must stay light.
  - EIP-6963 discovery is a few lines of code with no dependency.
  - The browser needs no signature library, because the server verifies.
  - If WalletConnect is later approved, its provider (about 139 KB gzipped) loads only when its row is chosen, in its own Rolldown group beside `react`.
  - The workspace shell keeps preloading after the gate, as today.
- **A small adapter instead of the wagmi stack for the first version.** Vessel only needs `eth_requestAccounts`, `personal_sign`, and the `accountsChanged` and `disconnect` events. A thin EIP-1193 adapter (about 150 lines) over EIP-6963 providers covers that without dependencies, React Query or a connector graph.
  - It never calls transaction, chain-switch or approval methods.
  - Announced wallet icons are data URIs rendered only through `<img>`, as EIP-6963 requires, so an SVG icon cannot run script.
  - wagmi 3 + viem (MIT) is the step up if WalletConnect or more connector types are approved.
- **Requests.** `api/request.ts` drops `Authorization` and sends `credentials: 'same-origin'` plus `X-Vessel-Request: 1`. A 401 anywhere emits `session-ended`. The gate returns to sign-in with "Your session ended", after the same Play-discard guard as Sign out.
- **One teardown.** The two disconnect halves become one `endSession(reason)` owned by the gate. It aborts refreshes, the monitor and market streams and the candle cache, resets drafts and the URL hash, calls `POST /api/auth/sign-out` and disconnects the wallet provider.
- **Reload.** On load the gate first calls `GET /api/auth/session`. A valid cookie goes straight to the workspace, with no wallet prompt.
- **Preferences.** `vessel.appearance` and `vessel.chart.preferences.v1` move to `vessel:{userId}:…`. The first signed-in user adopts the unprefixed values once, then they are removed.
- **Copy.** The owner card opens the account menu (Profile & sign-in, Sessions, Users for operators, Sign out). Settings gains a **Profile & sign-in** tab. The "Private session" panel's "Disconnect session" becomes Sign out.
- **Architecture tests:** `api/identity.ts` must not import features, and the workspace must not import `features/identity` internals except the gate and the account menu.

### Wallet connection

Versions, licences and dates were checked against npm, NuGet and project sources on October 17, 2026.

| Option | Current | Licence | Fit for Vessel |
| --- | --- | --- | --- |
| EIP-6963 discovery + Vessel adapter | Standard (Final) | — | **First version.** Own UI and theme tokens, no dependency, no third party |
| wagmi 3 + viem, own UI | wagmi 3.7.7, viem 2.57.7 | MIT | **Step up** if WalletConnect or more connectors are approved; React 19 supported; connectors are optional peers; TypeScript ≥ 5.9.3 |
| WalletConnect, headless | `@walletconnect/ethereum-provider` 2.26.0 | WalletConnect Community License (since 2.21.9) | Optional after a licence review (D4). Use the provider with `showQrModal: false`, `telemetryEnabled: false`, `optionalChains: [1]` and `optionalMethods: ['personal_sign']`, so the wallet's approval screen does not list transaction methods. wagmi's connector cannot narrow them. Render `display_uri` as a QR with a small MIT library |
| Reown AppKit | 1.8.24 | Reown Community License | No. Vendor modal; defaults turn on analytics, swaps, on-ramp, email and social login, and call `api.web3modal.org`. Custom (headless) UI is a paid feature |
| RainbowKit | 2.2.11 | MIT | No. Vendor modal, pinned to wagmi 2, and the button looks up ENS and balances |
| ConnectKit | 1.9.2 | BSD-2 | No. Declares React 17/18 only |
| Privy / Dynamic | 3.50 / 5.12 | SDKs open, service hosted | No. Hosted identity (Privy is now Stripe's) |
| Coinbase Wallet SDK | 4.4.0 | — | Not needed: the Coinbase extension appears through EIP-6963. The SDK opens `keys.coinbase.com` popups |

Not verified:
- whether MetaMask injects into plain-HTTP LAN pages and how it treats an `http://` scheme in the message;
- whether wallets accept a WalletConnect session that requests only `personal_sign`;
- the reach of the Reown licences over Vessel's distributed images.

These go into the phase 3 checks and the D4 review.

### Security headers

- **Without WalletConnect:** the CSP is unchanged. Injected wallets communicate through the extension, not the page's `connect-src`.
- **With WalletConnect (if D4 approves it):** from the 2.26.0 package constants, add `connect-src wss://relay.walletconnect.org https://verify.walletconnect.org` and `frame-src https://verify.walletconnect.org`.
  - Telemetry stays off, so `pulse.walletconnect.org` is not needed.
  - An RPC map is supplied, so `rpc.walletconnect.org` is not needed.
  - Reown's own recommended list is broader (`.com` twins, `api.web3modal.org`, fonts, image wildcards) because it serves AppKit; Vessel does not need it.
  - Re-derive the list whenever the provider version changes.
  - No reviewed package needs `unsafe-eval` or WebAssembly; transitive dependencies were not fully scanned.
  - `static-security.conf` therefore becomes an nginx template. The web container renders it from `VESSEL_WALLETCONNECT=on|off`, so the default image stays strict.
  - `scripts/verify-release.py` checks both renderings.
  - `release-browser-smoke.cjs` keeps blocking every external origin. WalletConnect is not exercised in CI.
- `/api/auth/*` responses keep `no-store`. The session cookie never appears in logs. `SafeExceptionDiagnostics` already omits headers.

### Configuration and deployment

| Setting | Default | Notes |
| --- | --- | --- |
| `Vessel:Auth:Mode` | `Token` in the first release, then `Wallet` | D3 |
| `Vessel:Identity:Origins` | none (required in `Wallet` mode) | Every URL the browser uses, e.g. `https://vessel.example.net`, `http://100.123.45.42:5180` in Development |
| `Vessel:Identity:Registration` | `Invitation` | D1 |
| `Vessel:Identity:AllowList` | empty | Lower-case addresses, for `AllowList` |
| `Vessel:Identity:Session:IdleDays` / `AbsoluteDays` | 14 / 30 | D8 |
| `Vessel:Identity:WalletConnect:ProjectId` | none | Only if D4 approves WalletConnect. The browser reads it at runtime from `/api/auth/config`, never from Vite. The operator restricts allowed origins in the Reown dashboard (an empty list allows all). The web container's `VESSEL_WALLETCONNECT` must match |
| `Vessel:Auth:OwnerId` | existing | In `Wallet` mode only the migration and `bind-wallet` command use it |

Offline API commands, in the style of `evidence-copy-to-s3`:
- `identity bind-wallet --owner <guid> --address 0x… [--operator]`
- `identity invite [--note] [--expires]`
- `identity suspend|restore --user <guid>`
- `identity revoke-sessions --user <guid>`

**Upgrade path for the owner's installation:**
1. Back up.
2. `migrate` creates the identity schema and inserts the configured owner as a user.
3. `identity bind-wallet --owner <configured guid> --address <owner's wallet> --operator`.
4. Set `Vessel:Auth:Mode=Wallet` and the origins, restart the API and worker, and sign in.

Every portfolio, account and Play stays where it is, because the owner ID does not change. Rolling back means setting `Mode=Token` again.

## Testing

- **Unit:** message factory (exact EIP-4361 text and grammar), signature recovery with known vectors (including `v` = 0/1/27/28 and high-`s` rejection), challenge expiry, single use and purpose binding, origin checks, invitation hashing and limits, session expiry arithmetic.
- **API (WebApplicationFactory):** the full sign-in, registration and link flows with a test private key signing in the test. Also replay, expired and cross-origin challenges, CSRF header and origin checks, suspended users, revoked sessions, rate limits, and `Token` mode unchanged.
- **Isolation suite:** two users, each with portfolios, accounts, Plays, evidence, credentials, monitor state and events. A generated test walks every mapped endpoint with user B's session and user A's IDs and expects 404 or an empty result. It also checks that no list, count, summary or stream mixes the two users. This is the most important test of the whole project.
- **Worker and messaging:** commands and events for two owners. Each runs in its own scope, and a message naming a suspended or unknown owner dead-letters.
- **Browser:** an injected test EIP-6963 provider (a small script that announces a provider and signs with a fixed test key through viem's `privateKeyToAccount`) drives the real sign-in in `release-browser-smoke.cjs` and `scripts/e2e/browser-e2e.cjs`. This replaces the "API token" fill. No real wallet or WalletConnect relay is used in CI.

## Plan

| Phase | Pull request | Contents | Depends on |
| --- | --- | --- | --- |
| 0 | — | Owner decisions D1–D12, design round on the mockups | — |
| 1 | Identity backend | `Vessel.Identity` project, schema and migration (including the configured owner as user), message factory, verifier, challenge/verify/register/session/sign-out endpoints, cookie handler, CSRF, rate limits, `Vessel:Auth:Mode`, `bind-wallet` and `invite` commands, unit and API tests. `Token` stays the default, so nothing changes for the running installation. | 0 |
| 2 | Multi-owner backend | The owner directory and settable owner scopes. Cross-owner monitor claims with `OwnerId` on leases. Server-wide venue budget and heartbeat (one small migration). Per-owner subscription registration, catch-up and retention, so that no event of a new owner is silently acknowledged. Owner-aware offline commands, per-user stream and refresh caps, the two integrity foreign keys. Includes the isolation suite. | 1 |
| 3 | Identity frontend | Sign-in gate and wallet selector (EIP-6963 adapter; WalletConnect only if D4 approves it), the sign/create/error states from the mockups, request changes, the 401 path, one teardown, per-user preferences, the account menu, Profile & sign-in (wallets, sessions), copy updates, browser smoke with the test provider, and CSP templating. | 1 (2 for multi-user use) |
| 4 | Deployment and release | Compose and `.env` settings, README upgrade and rollback runbook, `verify-release.py` cookie and CSP checks, release notes. Switch the default to `Wallet` after the owner verifies it. | 2, 3 |
| 5 | Later, each separately authorized | WalletConnect after the licence review, operator page (users, invitations, registration mode), smart-contract wallets through a configured RPC (EIP-1271/ERC-6492), journal export and deletion, per-user notification routing for the Notification Hub, removal of `Token` mode, server-side preferences | 4 |

Phases 1 and 2 can be built in parallel by separate agents with disjoint write scopes (identity project versus existing persistence and worker), as in earlier stacked work. Phase 3 needs only phase 1's contract.

## Risks

- **Lost wallet, lost journal.** There is no email reset. Mitigations: several linked wallets (D6), the lock-out warning at registration, and operator `bind-wallet` recovery after an out-of-band check, documented as such. Hashed one-time recovery codes, or passkeys (supported by ASP.NET Core Identity in .NET 10, but they need HTTPS and a real domain), are later options.
- **Silent event loss for new users.** Today an owner without a subscription row is answered *not responsible*, and that is acknowledged. Phase 2 must make this impossible and test it with two owners.
- **Isolation regressions.** Raw SQL, `IgnoreQueryFilters` and new background jobs can bypass the owner filter. Today `src` has no `IgnoreQueryFilters`, and every raw SQL statement adds an explicit owner predicate. The new cross-owner monitor claim is the first deliberate exception. Mitigations: the isolation suite, an architecture test that lists every raw SQL and `IgnoreQueryFilters` site with an owner predicate, and review checklists.
- **Venue rate limits** scale with users, but one server IP shares them. A server-wide budget is required before more than a handful of users (phase 2).
- **Phishing and look-alike origins.** The message binds the domain and Vessel never accepts an origin outside the configured list. Most wallets other than MetaMask and Phantom do not enforce the domain, though, so a live relay through a phishing page remains possible. Mitigations: short challenges, a visible session list, and [step-up signatures](#step-up-signatures) for sensitive actions. The October 17 research recommends a dedicated sign-in wallet, because the same address across sites is a linkable identifier.
- **Privacy.** A sign-in address is a public on-chain identity. Vessel stores it and shows it only to its user. Optional WalletConnect discloses the address and sign-in to its relay. The operator sees display names, wallet addresses and activity times, never journals.
- **HTTP on the LAN.** Secure cookies and some wallet features need a secure context. HTTPS through the Caddy overlay is the normal path; the Development exception keeps LAN previews working.
- **Wording drift.** "Never signs anything" was a product promise. The new wording must stay precise: Vessel never signs, sends or approves anything at a venue; signing in is a wallet signature over a text message.

## Out of scope

Order execution, any venue signing, using the sign-in wallet as a venue source automatically, ENS names (which need an RPC), passkeys or OIDC, billing, shared journals between users, and deployment or migration of the owner's database.
