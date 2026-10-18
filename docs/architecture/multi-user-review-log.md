# Multi-user wallet sign-in: review log

The record of the agent discussion the owner asked for on October 17, 2026: Opus and Sol agents discuss and verify the approach before implementation.

- **Subject:** [the analysis](multi-user-wallet-auth.md) at commit 2fb3082, then [the delivery contract](multi-user-delivery-contract.md).
- **Reviewers:** GPT-6.1-Sol (Codex, extra-high reasoning) and Claude Opus 5.5. Both read the repository only; neither changed it.

## Round 1: independent reviews of the analysis

Both verdicts: **go with changes**.

### Where they agreed

The orchestrator folded these into the contract:
- Keep the owner GUID as user 1. Keep identity in its own project and schema, with no foreign keys between schemas.
- No seeding inside a migration. Use a second migration bundle, an `ensure-owner` step, and readiness checks for both contexts.
- The plan's event-subscription options would skip a new owner's first event. A precise algorithm is needed.
- Background child scopes lose the owner. Renewals after 1 minute would fail. Leases need `OwnerId`.
- Ownerless monitor tables conflict with the `IOwned` rule. Cross-owner claims must not weaken the owner filter or the save guard.
- No phase built the wallet, session, profile and step-up endpoints.
- Ambient cookies let a stale tab write into another user's journal. A forced session end must not wait on the discard guard.
- Open streams outlive revocation.
- The CSRF content-type rule breaks multipart evidence uploads.
- A restore revives revoked sessions and removed wallets.
- Never flip the mode default implicitly. Keep a dual-mode frontend.
- The link statement must not interpolate a display name.
- A 65-byte signature that recovers another address does not mean a smart-contract wallet.
- Defer WalletConnect. Prefer the small EIP-6963 adapter over wagmi.
- Release scripts and test fixtures assume one owner and a bearer token. A fixed `identity` schema breaks the `SearchPath` test isolation.

### Where they differed, and the resolution

| Topic | Sol | Opus | Contract |
| --- | --- | --- | --- |
| D8 session length | Disagreed with the long default; shorter, or an explicit remember-device choice | 14 / 30 days, given safeguards | Remember-device, off by default: 12 h / 24 h without it, 14 d / 30 d with it (§1, §3) |
| Subscription algorithm | Lazy creation **before** sequence allocation, under the cursor lock, from provisioned definitions | Server-wide registration table; a missing progress row means responsible from the start, created on the subscriber side only; provisioning backfills existing owners | Opus's design (§9.2), because publishers must not write subscriber state. **Sol to verify in round 2** |
| Session cache | None until invalidation is designed and tested | At most 30 s, with local eviction on revoke | No cache in this version (§7) |
| Invitation entropy | At least 128 bits | At least 64 bits | 128 bits (§7) |
| Tab binding | A non-secret session or principal identifier that the server checks | `X-Vessel-User: <user id>` | `X-Vessel-User` with the user ID, plus a BroadcastChannel and a generation guard (§7, §11) |
| CSRF mechanism | One documented policy; notes that antiforgery tokens can travel in headers | `Sec-Fetch-Site`/Origin plus a custom header, no CORS | Origin required and exact; `Sec-Fetch-Site` same-origin when present; custom header; no content-type rule (§7) |
| High-`s` signatures | Define scalar rules | Accept or normalize | Normalize and accept (§5) |
| Step-up for saving a venue token | — | Drop it: the token is write-only and the prompt interrupts Lighter import | Dropped. Step-up only for linking and removing a wallet (§6) |

### Round 1 reviews, verbatim

<details><summary>GPT-6.1-Sol, round 1</summary>

**Verdict: Go-with-changes.** The direction is sound: preserve the owner GUID, keep identity separate from journal persistence, use server-generated SIWE messages and opaque server-side sessions, and defer WalletConnect. However, this is **not yet an implementation-ready four-PR contract**. Challenge storage, subscription registration, cross-owner scheduling, session transitions and upgrade/restore semantics need resolution before their implementations start. The existing journal isolation mechanisms are a strong foundation; several proposed changes would bypass or conflict with them if implemented literally.

**Findings**

1. **Blocker — Challenge storage cannot support the specified verifier.** The schema stores nonce/message hashes, `/verify` receives only the signature, but the selected recovery API needs the original message. **Change:** Persist the exact signed UTF-8 message, alongside immutable purpose/origin/binding fields. Do not reconstruct messages from mutable names. Remove unrestricted `{name}` interpolation from statements.
2. **Blocker — "Lazy registration or registration at user creation" is not a sufficient subscription algorithm.** Evidence: `EventSubscriptionRegistry.cs:16–26`; `EventDispatcher.cs:191–205`; `EventCatchUp.cs:23–31`. Registration initializes both responsibility and low-water marks to the current cursor. Registering after allocating the first event excludes that event permanently; catch-up also excludes it. Creation-time registration alone misses subscriptions introduced after users already exist. **Change:** Prefer lazy initialization before sequence allocation, under the cursor transaction/lock, from durable provisioned subscription definitions. Define provisioning for existing users, responsibility boundaries and deregistration races. Test first-event delivery, concurrent first events, new subscriptions, rollback, broker loss, receipts and retention.
3. **Major — Step-up and wallet-linking need an explicit security transaction.** Bind proofs to the session, immutable action and relevant target; define expiry and consumption. Recheck active user, linked signer and authorization at completion. Serialize wallet changes per user. Registration always creates `member`; promotion is explicit privileged CLI work. Assign all required APIs to a phase.
4. **Major — Ambient cookies introduce a cross-tab, cross-user mutation risk.** Evidence: `request.ts:47–72`; `ApplicationShell.tsx:234–245`. **Change:** Bind each client instance to a non-secret session/principal identifier that the server checks, never uses to select ownership. Add cross-tab invalidation and generation guards. Forced expiry/revocation teardown must be unconditional; only voluntary sign-out asks about drafts. Distinguish 401 from 403, and prevent stale failures/sign-out requests from terminating a newer session.
5. **Major — Revocation is ineffective on already-open private streams.** Evidence: `VesselEventEndpoints.cs:61–76`; `MarketStreamService.cs:43–64`. **Change:** Specify a bounded revocation/expiry enforcement interval, including open SSE, across API replicas. Start without an authentication cache unless its invalidation contract is implemented and tested.
6. **Major — The CSRF content-type rule breaks existing evidence uploads.** Evidence: `EvidenceEndpoints.cs:17`, `:41–59`. **Change:** Choose one documented CSRF policy covering public auth endpoints, authenticated JSON, multipart uploads and bodyless DELETEs.
7. **Major — Cross-owner claims and global tables conflict with the existing DbContext invariant.** Evidence: `VesselDbContext.cs:51–80`; `MonitorStore.cs:185–222`; `MonitorModel.cs:30–38`. **Change:** A narrow system-level discovery/claim store returning DTOs, followed by validated owner-scoped execution. Place global tables outside the owned-entity model. Do not weaken the filter/save guard. Define lock order and fairness.
8. **Major — The proposed "server-wide" venue budget does not cover all upstream traffic.** Evidence: `LighterReader.cs:23–25`, `:50–65`; `MonitorStore.cs:230–237`. **Change:** Define which upstream reads consume the shared budget and observe venue cooldowns. Do not describe a static semaphore as a server-wide guarantee.
9. **Major — Active-owner enumeration is wrong for retained-data maintenance.** Evidence: `SubscriptionMaintenanceService.cs:28–46`. **Change:** Separate retained-owner enumeration from work eligibility. Specify paused receipt handling, retention protection, reactivation/catch-up and in-flight monitor settlement after suspension. Bounded enumeration.
10. **Major — Separate identity persistence is appropriate, but packaging/bootstrap is not specified.** Evidence: `Dockerfile:14–16`, `:31`; `deploy/migrate:6–7`; `VesselDbContextFactory.cs:18–20`; `Program.cs:97–104`. **Change:** Define both bundles/history tables, ordering, retry behaviour, readiness and Worker composition. Schema migrations, then explicit idempotent bootstrap with the configured GUID. Defer hard user deletion.
11. **Major — Token-mode compatibility and default switching can lock out installations.** Evidence: `ProductionConfiguration.cs:14–20`; `compose.yaml:83`, `:98–100`. **Change:** Preserve both frontend transports behind an exclusively selected server mode; mode-dependent startup validation; never change an installation's effective mode implicitly.
12. **Major — Restore can resurrect revoked credentials.** Evidence: `deploy/README.md:819–825`; `EventStreamEpoch.cs:17`. **Change:** An offline pre-start auth-reset/reconciliation step. Test restore from a backup predating revocation.
13. **Major — The fixed identity schema defeats existing test isolation.** Evidence: `PostgresTests.cs:117–145`. **Change:** Isolated identity schemas/history/model configuration before integration tests. Positive controls and post-mutation assertions for route/body/query/bulk/nested foreign IDs, evidence bytes, credential AAD, idempotency keys, identical native venue identities, concurrent HTTP contexts, owner-scoped renewals, subscription races and cross-tab cookie replacement.
14. **Major — Invitation entropy and admission limits need strengthening.** At least 128 random bits, atomic use-count consumption, bounded challenge/registration/session storage with cleanup, aggregate limits. Keep wallet lookup after valid signature verification.
15. **Minor — Wallet adapter and failure copy need a narrower contract.** A 65-byte signature recovering another address does not establish a smart-contract wallet. "Unreachable" cannot always promise the wallet was never asked to sign. Treat EIP-6963 metadata as untrusted, bounded display data. The small adapter is preferable to wagmi; add real-wallet compatibility checks.

**Missed single-owner assumptions:**
- `MonitorRegistration.cs:63–72`
- `MonitorScheduler.cs:64–74`, `:93–109`
- `MessagingProvisioning.cs:90–95`
- `VesselDbContextFactory.cs:18–20`
- `VesselEventEndpoints.cs:61–76`
- frontend singleton preference snapshots: `appearance.ts:184–197`, `chartPreferences.ts:64–85`
- **Audit correction:** intentional ownerless raw SQL exists in `EvidenceCopyCommand.cs:66` and `EventStreamEpoch.cs:17`; keep a reviewed allow-list.

**D1–D12 positions:**
- **D1:** agree, with stronger entropy and aggregate limits.
- **D2:** agree.
- **D3:** agree with changes: exclusive modes, dual-mode frontend, no implicit flip.
- **D4:** agree.
- **D5:** agree; do not pretend malformed signatures identify contract wallets.
- **D6:** agree, with serialized last-wallet checks.
- **D7:** agree; application authorization only.
- **D8:** disagree with the default; use a shorter default or a remember-device choice.
- **D9:** agree.
- **D10:** agree with changes: reset singleton state; legacy values belong to the migrated owner.
- **D11:** agree.
- **D12:** agree provisionally.

**Parallelization:**
1. A contract checkpoint first.
2. Then concurrent lanes:
   - identity backend, including the wallet, session, profile and step-up APIs;
   - journal and worker after the owner-scope and subscription contracts are frozen;
   - frontend against the frozen API, with one integrator for transport, teardown and preferences.
3. One owner for the shared integration: ports, composition, solution rules, Docker, Compose and harnesses.
4. Deployment and security tests start early.
5. Leave the CSP unchanged.

</details>

<details><summary>Claude Opus 5.5, round 1</summary>

**Verdict: go-with-changes.** The plan's main idea holds. A user can simply be a journal owner, with the user ID equal to the owner ID. Every query is filtered by owner and saves that would change an owner are refused (`VesselDbContext.cs:53-81`). Every raw SQL statement in the journal stores includes an owner predicate, and nothing in `src` uses `IgnoreQueryFilters`. Stored credentials bind the owner ID, all IDs are server-generated, every unique index includes `OwnerId`, and every cache holds only public data. The approach is right. The plan is not ready for implementers until these are fixed: the phase 2 event-subscription and owner-scope designs, the server-wide monitor tables, the missing wallet/session/step-up backend phase, first-user seeding, and the cookie-session consequences.

**Findings**

1. **Blocker — event subscriptions.** Evidence: `EventSubscriptionRegistry.cs:16-26`; `VesselEventStore.cs:94-96,139-141`; `EventDispatcher.cs:30,77,191-206`; `MessagingProvisioning.cs:50-56,94`.
   - Lazy creation inside the unit of work must precede the cursor increment, or the first event is skipped. It also makes the publishing API write subscriber state, against the October 15 rule.
   - Registration at user creation crosses into journal persistence and misses later subscriptions.
   - **Change:** a server-wide `event_subscription_registrations` table with per-owner progress rows. Provisioning inserts the registration and, in the same transaction, progress rows for every owner in `event_cursors` at its committed cursor. Only the subscriber side treats a missing progress row as responsible from 0, creating it with `ON CONFLICT DO NOTHING` and marking it lagging with a gap if `retention_floor` > 0. Catch-up uses one cross-owner query per subscription. `deregister` becomes server-wide; `--owner` and `--all-owners` belong on `retry-event-receipts`.
2. **Blocker — missing phase.** No phase builds the wallet, session, step-up and profile endpoints, or the `suspend`, `restore` and `revoke-sessions` commands. **Change:** add phase 1b after phase 1, including the 403 `step-up-required` contract.
3. **Major — owner scopes in the worker.** Evidence: `MonitorRegistration.cs:70`; `MonitorScheduler.cs:64,93,108`; `SubscriptionMaintenanceService.cs:33,45`; `EventSubscriptionListener.cs:47`; `MonitorCommandListener.cs:23`. With a throwing scoped owner context, the first renewal throws, so runs longer than a minute die and retry forever. **Change:** `IOwnerScopeFactory.CreateAsyncScope(ownerId)` for every child scope, `OwnerId` on `MonitorLease`, and an architecture test forbidding `IServiceScopeFactory` in worker and messaging code.
4. **Major — ownerless tables against the owned-entity rule.** Evidence: `VesselDbContext.cs:57-61`; `MonitorModel.cs:30-38`. **Change:** move both tables to a raw-SQL server-state store. Count venue concurrency with cross-owner raw SQL under a per-venue advisory lock taken after the per-owner lock.
5. **Major — cross-owner claim mechanics.** Evidence: `MonitorStore.cs:189-198,167-172,139-165`. Cross-owner selection holding row locks while owner-scoped claims run elsewhere would deadlock. **Change:** discovery stays per owner; the only cross-owner SQL is a lock-free candidate query; claims run in owner scopes. The two-run cap (`MonitorScheduler.cs:70-74`) needs a `WorkerConcurrency` setting.
6. **Major — phase 1 alone enables broken multi-user use.** **Change:** force registration Closed until phase 2 merges.
7. **Major — upgrade seeding and migrations.** The EF bundle has no configuration; readiness checks only `VesselDbContext`; both contexts would share `public.__EFMigrationsHistory`. **Change:** an identity schema and history table with its own bundle; run identity, then journal migrations, then idempotent `ensure-owner`, then provisioning; readiness checks both; Wallet mode needs an operator with a wallet.
8. **Major — Decision 3 default flip causes lock-out.** **Change:** never flip silently. In Wallet mode do not register `BearerTokenHandler`, and refuse to start if `Vessel:Auth:Token` is set. In Token mode map only `/api/auth/config`.
9. **Major — one cookie jar for all tabs.** Evidence: `ConnectionGate.tsx:14-42`; `request.ts:48-67`. **Change:** `X-Vessel-User` on every request, answered with 401 `session-user-mismatch` when it differs; BroadcastChannel; a full `location.replace('/')` on sign-out and session end.
10. **Major — streams outlive revocation.** Evidence: `VesselEventEndpoints.cs:61-77`; `MarketStreamService.cs:43`. **Change:** re-check the session on every poll and keepalive; a session cache of at most 30 s with eviction on revoke; a global event-stream cap.
11. **Major — restore brings back revoked access.** Evidence: `deploy/README.md:820-826`, `:772-784`. **Change:** a mandatory `identity revoke-sessions --all` plus purging challenges and pending registrations before any host starts, a wallet review, and the same in the `verify-release` restore check.
12. **Major — cookies are shared across ports.** `__Host-` and SameSite ignore ports. **Change:** document that Vessel needs its own hostname; add `Vessel:Identity:CookieName`.
13. **Major — targeted lock-out through per-address limits.** **Change:** limit challenges per IP (/64 for IPv6) and globally, evicting the oldest open challenges; never refuse a valid signature because of per-address counters.
14. **Major — enumeration through check ordering.** **Change:** challenge endpoints never read users, wallets or the allow-list; those codes are decided only after a valid signature.
15. **Minor — 401 and 403 are treated alike** (`request.ts:24-26,72`). **Change:** 401 means the session ended; a 403 is handled by its code.
16. **Minor — CSRF rule against multipart uploads** (`EvidenceEndpoints.cs:49`). **Change:** allow multipart; apply the guard to cookie-authenticated requests and the public auth endpoints.
17. **Minor — module boundary.** **Change:** Identity references only Application; the API and worker reference Identity. Identity has its own transaction helper. No cross-schema foreign keys, plus an `identity verify` orphan check. Define suspension now.
18. **Minor — per-user venue limits** (`WorkspaceEndpoints.cs:18,23`; `LighterReader.cs:25,50`). **Change:** per-user rate limits for discovery, verification and Refresh; quotas before allow-list or open registration.
19. **Minor — `/api/auth/config`** must return only a boolean for the requesting origin.
20. **Minor — release checks in Wallet mode.** Evidence: `verify-release.py:149,202,222,350,412-422`; `browser-e2e.cjs:16,80`; `release-browser-smoke.cjs:41`. Python and Node "sha3" are not Keccak. **Change:** a Node signer with `@noble/curves` and `@noble/hashes` exposed to the page; run `verify-release` in both modes.
21. **Minor — the display name in the link statement.** **Change:** fixed text plus the session wallet's address; restrict display names to printable characters.
22. **Minor — phase 3 scope and the pre-sign-in theme.** **Change:** no CSP templating while WalletConnect is deferred; a device-level theme key for the sign-in screen (`main.tsx:10`, `appearance.ts:195`).
23. **Minor — the isolation suite.**
    - A test authentication scheme.
    - Identical 404 bodies for foreign and nonexistent IDs.
    - IDs in request bodies.
    - The event stream and cursors, credential binding, evidence keys.
    - The same source and fill IDs in both owners.
    - Two-owner worker cases, and an owner created after provisioning.
    - An inventory test covering raw SQL, `IgnoreQueryFilters` and scope creation.
24. **Nit — smaller corrections.**
    - Accept or normalize high-`s`.
    - Classify a wallet as unsupported only by format (length, the 6492 suffix, `v`).
    - Store the full message.
    - The domain is the full host and port.
    - Invitations of at least 64 bits.
    - Random v4 user IDs.
    - Remove the "Domain matches this page" tick.
    - Revoke an existing session at sign-in.
    - Drop step-up for saving a token.
    - A `window.ethereum` fallback for in-app browsers.

**Missed single-owner assumptions:**
- The child scopes listed in finding 3.
- The two-run cap (`MonitorScheduler.cs:70-74`).
- The owned-entity rule against the monitor tables (`VesselDbContext.cs:57-61`; `MonitorModel.cs:30-38`).
- One migration context (`Program.cs:102`; `Dockerfile:14-16`; `deploy/migrate:6-7`).
- The event stream's single authentication and per-owner cap (`VesselEventEndpoints.cs:16,61-77,97-105`).
- Tab-bound identity and the 401/403 mapping in the frontend.
- The theme applied before sign-in.
- The restore runbook.
- Bearer-only release scripts.
- Compose requiring the token and owner (`compose.yaml:83,98,132`).
- The well-known default owner GUID (`JournalOwner.cs:12`).
- Provisioning's configured-owner singleton (`MessagingProvisioning.cs:94`).

**D1–D12 positions:**
- **D1:** agree, plus quotas before allow-list or open registration.
- **D2:** agree, with `ensure-owner` and refusing to start without an operator wallet.
- **D3:** keep Token, never flip silently; reject the bearer token in Wallet mode.
- **D4, D5:** agree.
- **D6:** agree; schedule its backend.
- **D7:** agree.
- **D8:** agree with 14 / 30 days, provided stream re-checks, a short cache and restore revocation.
- **D9:** agree, with the server-wide budget and per-user limits.
- **D10:** agree, plus a device theme and a full reload.
- **D11:** agree; define suspension now.
- **D12:** agree.

**Parallelization:**
1. The contract first.
2. In parallel:
   - phase 1, identity backend;
   - phase 2a, owner scopes and messaging;
   - phase 2c, isolation suite;
   - phase 3, frontend against a fake API.
3. Later:
   - phase 2b after 2a;
   - phase 1b after phase 1;
   - phase 4 after everything else.
4. Wallet mode for more than one user waits for 2b.

</details>

## Round 2: verification of contract version 1

| Reviewer | Verdict | Required edits |
| --- | --- | --- |
| GPT-6.1-Sol | **Not ready** | 18 |
| Claude Opus 5.5 | **Ready with edits** | 37 |

**Both found:**
- `/verify` cleared the binding cookie that `/register` needs.
- Provisioning backfilled at the current cursor on every run, so re-provisioning skipped events.
- A missing progress row had to be initialized under the owner's retention lock, with a registration foreign key.
- Catch-up discovery missed pending receipts below the low-water mark.
- The owner-scope bridge could not be built across the Persistence/Infrastructure boundary.
- The candidate query needed fairness, and claims needed one transaction per candidate under a full lock order.
- The ownerless monitor tables needed a destructive-migration plan.
- The packaging had to keep Token mode compatible and isolate identity migrations.
- Write-scope fixes and missing tests.

**Sol also found:**
- a stale tab could sign out the newer session of the same user, so sign-out now names its session (`session-changed`);
- step-up and wallet changes need re-checks at completion;
- venue rate-limit exceptions are swallowed by safe-error conversion;
- restore reconciliation needs wallet addresses and `unbind-wallet`.

**Opus also found:**
- the page's `Referrer-Policy: no-referrer` makes browsers send `Origin: null` on writes, so fetches now set `referrerPolicy: "same-origin"`;
- busy market streams send no keepalive, so revalidation runs on a timer;
- the `beforeunload` prompt defeated forced teardown;
- `/api/auth/{**rest}` gave 401 instead of 404 in Token mode;
- invitation code normalization was missing.

**On each other's positions:**
- Sol accepted the remember-device default, the CSRF policy, high-`s` normalization and dropping step-up for venue tokens.
- Sol accepted user-ID tab binding for isolation, but required session-aware sign-out.
- Opus accepted having no session cache (about 10 requests per page, one indexed lookup each), the remember-device default and 128-bit invitations.

The orchestrator rewrote the contract as version 2. Its §14 records the decisions where the two differed.

## Round 3: confirmation of contract version 2

**GPT-6.1-Sol: not ready.**
- All 18 edits applied and all §14 decisions accepted.
- Two small gaps:
  - the step-up grant did not record its signing wallet;
  - restore reconciliation was not fail-closed: a previously removed wallet could get a fresh session.

**Claude Opus 5.5: ready.**
- All §14 decisions accepted.
- Four blockers:
  - thrown 429s lost `Retry-After` in the error handler, which `ProblemException` now covers;
  - the messaging provisioning container had no owner context that reads the assignment;
  - the wrong monitor candidate type;
  - the wrong base branch name.
- Smaller clarifications:
  - the default-GUID refusal belongs to Wallet mode only;
  - `ensure-owner` should run always and do nothing in Token mode;
  - B1's interim scheduler;
  - the initialization helper should lock the registration first;
  - a 401 from the session probe must never reload.

All of these are applied in contract version 3 (§15). With them, both reviewers' remaining blockers are closed, and implementation starts from version 3.
