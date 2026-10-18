# Multi-user wallet sign-in — delivery state

October 18, 2026. P4, based on `be9474b` (the verified A1 → B1 → A2 → B2 →
C1 → D1 stack), on `t3/mu-p4-deploy-docs`. This is implementation/verification
state, not a merged release, a published image or a deployed installation.
Authority: [delivery contract](multi-user-delivery-contract.md), including §16;
review history: [review log](multi-user-review-log.md#implementation-round--october-18-2026).
The original analysis/prototype is historical, not an implementation gate.

## Implemented

| Lane | Delivered boundary | Verification |
| --- | --- | --- |
| A1 identity core | Separate Identity module/schema/history and EF bundle; EOA SIWE challenge/verification, invitation registration, bounded cookie sessions, request guard, directory and open-stream revalidation; explicit owner bootstrap/readiness. | Identity tests, host route/security inventory, both-mode/order composition and full backend suite; Opus fixes recorded in the review log. |
| B1 scopes/events | Assigned fresh background scopes, mode-selected owner directory, reviewed singleton system stores, server subscription registration with subscriber-side per-owner progress, owner-aware catch-up/retention/listeners. | Owner-scope architecture/inventory, multi-owner worker/event/messaging tests and isolation suite; independent Opus verification. |
| A2 identity accounts | Profile/revision, linked wallets (20 cap), sessions, action-bound single-use step-up, offline suspension/role/recovery commands and restore reset. | Identity account/administration/readiness/wallet-cap tests and full suite; independent Opus verification and §16 decisions. |
| B2 monitor/limits | Fair candidate/claim scheduling, account `SKIP LOCKED`, database-backed cross-owner venue capacity/deadlines, per-deployment heartbeats, per-user API budgets; registration constant enabled. | Multi-owner monitor/worker/limits tests, migration tests and full suite; independent Opus fixes verified. |
| C1 isolation | Positive-control HTTP isolation, exact hidden-resource responses, per-attempt state snapshots, mutation probes, Token and Wallet harnesses. | 66 isolation cases in the inherited verified stack; rerun evidence below. Opus implementation, independent Sol review/fixes. |
| D1 frontend | Mode discovery, EIP-6963 sign-in/registration/profile/step-up, account menu, generation and terminal-session transport, cross-tab teardown, scoped preferences. | 2,307 Vitest cases, typecheck/lint/build; independent Sol reviews/fixes. |
| P4 deployment/docs | Explicit Wallet Compose overlay (Token default unchanged), operator settings/CLI/upgrade/restore runbooks, developer references, packaged `--auth wallet` check and external noble-signed browser smoke. | Local verification below; P4 has not received a separate independent review in this worktree. |

D1–D12 are **adopted working defaults**, not answers retroactively attributed to
the owner. They remain owner-overridable through explicit configuration or a
small reviewed code change. Token stays the default. An operator opts into
Wallet over HTTPS; start with registration `Closed` until the acceptance
checklist is complete. User IDs preserve existing journal owner GUIDs and
credential-encryption bindings. Operator role grants no journal bypass.

## Verification evidence

All commands ran only in `/home/ops/.local/share/vessel-mu/worktrees/p4`.
JavaScript used pinned pnpm 12.8.1; Node 24.18.0; .NET SDK 10.0.302 from
`$HOME/.dotnet`. Backend checks sourced `/tmp/vessel-mu/test-env.sh` without
printing it and used disposable services, not the owner/developer database.
Image builds were sequential. No branch/tag/image push, publication, live
migration or installation change was performed.

| Command | Result |
| --- | --- |
| `export PATH=$HOME/.local/share/pnpm/bin:$PATH; pnpm install --frozen-lockfile` | Passed; no lockfile change. |
| `pnpm --filter vessel-frontend typecheck` | Passed. |
| `pnpm --filter vessel-frontend lint` | Passed, zero warnings. |
| `pnpm --filter vessel-frontend test` | Initial run: 2,306 passed, one timing-sensitive fixture comparison failed (two `new Date()` fixtures differed by 1 ms in `sign-in-machine.test.ts:31`). No application/test file changed. |
| `pnpm --filter vessel-frontend test -- src/features/identity/sign-in-machine.test.ts` | This invocation reran the whole suite: **2,307 passed, 127 files**, zero failures. |
| `pnpm --filter vessel-frontend build` | Passed. |
| `pnpm test:prototype` | **76 passed**. |
| `dotnet restore backend/Vessel.slnx --locked-mode` | Passed. |
| `dotnet build backend/Vessel.slnx --no-restore --configuration Release -m:1` | Passed, zero warnings/errors. |
| `dotnet test backend/Vessel.slnx --no-build --configuration Release` | **2,890 passed, five opt-in skips, 2,895 total**. Skips: three live venue tests and two S3 environment/CLI opt-ins. |
| `python3 -m unittest discover -s scripts -p 'test_*.py'` | **63 passed** (rerun after the script edits). |

Additional focused/backend and packaged checks:

| Command | Result |
| --- | --- |
| `dotnet test backend/Vessel.slnx --no-build --configuration Release --filter 'FullyQualifiedName~Vessel.Tests.Isolation'` | **66 passed**, zero skips. |
| `dotnet test backend/Vessel.slnx --no-build --configuration Release --filter 'FullyQualifiedName~Vessel.Tests.Isolation\|FullyQualifiedName~Vessel.Tests.MultiOwner\|FullyQualifiedName~Vessel.Tests.OwnerScopeArchitectureTests'` | **120 passed**, zero skips. Covers both directory modes, two-owner worker/events/messaging, server limits and the reviewed SQL/scope inventory. |
| `python3 scripts/verify-release.py` | **152 assertions passed** with S3/RustFS: HTTP 44, TLS 47, image 5, monitor 26, restore 12, security 8, worker 10. Cleanup completed. |
| `python3 scripts/verify-release.py --storage local` | **152 assertions passed**, including retained local evidence and fresh-volume restore; cleanup completed. |
| `CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell python3 scripts/verify-release.py --browser-module /tmp/vessel-pw/node_modules/playwright` | Token regression: **152 packaged + 14 Chromium browser assertions passed**, zero CSP/console/page errors; cleanup completed. |

Wallet packaged/browser command (synthetic keys only, no real wallet):

```sh
source /tmp/vessel-mu/test-env.sh
export NOBLE_MODULE_DIR=/tmp/vessel-pw/node_modules
export CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
python3 scripts/verify-release.py --auth wallet \
  --browser-module /tmp/vessel-pw/node_modules/playwright --wallet-browsers chromium
```

**Passed: 128 packaged assertions plus 10 Chromium assertions.** Matrix:
TLS 44, image 5, monitor 26, restore 12, security 8, wallet 23, worker 10.
The check ran both EF bundles via `deploy/migrate`, demonstrated
`no-operator-wallet`, bound the synthetic operator, inspected both host cookies,
rejected bearer/stale-user/foreign-origin requests, and signed out. For recovery:
it proved the operator session was live at backup, revoked it **after** the dump,
restored that older database with all hosts stopped, ran reset/epoch rotation
before provisioning/start, and got **401** for the restored session. A fresh
signature recovered the confirmed operator's journal and original evidence.
Original and restore project containers/volumes/networks and both temporary
image tags were removed by the harness. A final bounded label/tag audit of all
six P4 disposable project bases (including the failed harness attempt) found no
remaining containers, volumes, networks or temporary image tags.

The first
Chromium attempt passed registration/cookies/writes/linking/isolation, then the
harness navigation to `/favicon.ico` was aborted; it now uses the plain
`/health/live` document for its independent stream reader. No application code
was changed for this harness correction.
Transient logs are under `/tmp/vessel-mu/p4-*`; they are not installation
configuration or a durable backup. Results/counts in this document are the
repository record, not a promise that those temporary files remain.

## Contract §10 activation checklist

| Gate | Outcome / evidence |
| --- | --- |
| Isolation suite | **PASS:** 66 isolation cases, zero skips, focused Token/Wallet rerun plus full backend run. |
| Two-owner worker/events | **PASS:** focused 120-case isolation/multi-owner/scope-inventory run and full backend suite; includes `MultiOwnerWorkerTests`, `MultiOwnerEventTests`, `MultiOwnerMessagingTests` and `MultiOwnerMonitorLimitsTests`. |
| Revocation of already-open streams | **PASS:** real Chromium frontend bodyless session DELETE closed an independent already-open server SSE reader in **14,325 ms** (≤15 s + 5 s margin); backend identity/stream/isolation cases also passed. |
| HTTPS cookies | **PASS:** packaged HTTPS check and Chromium inspect binding/session `__Host-` names, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. |
| Restore reset | **PASS:** packaged backup had a live operator session; revocation happened after the dump; reset ran offline after restore; the resurrected cookie returned 401, then a new signature authenticated the preserved operator GUID. |
| Real-wallet compatibility, including non-mainnet EOA | **OWNER-PENDING**; exact acceptance steps below. Synthetic noble signatures are not a real-wallet compatibility test. |
| Wallet writes in Chromium | **PASS:** ten Chromium browser assertions: EIP-6963/invitation/shell, POST, frontend profile PATCH, bodyless DELETE, multipart evidence, step-up recovery link, two-user isolation, open-stream revocation and sign-out; zero page/CSP errors or external calls. |
| Wallet writes in Firefox | **HOST-BLOCKED, NOT PASSED.** Playwright 1.58.2 downloaded Firefox 146.0.1 (revision 1509); launch fails with `browserType.launch: Host system is missing dependencies to run browsers.` Missing system libraries include `libXcursor.so.1`, `libgtk-3.so.0`, `libgdk-3.so.0`, `libpangocairo-1.0.so.0`, `libpango-1.0.so.0`, `libcairo-gobject.so.2`, `libcairo.so.2`, `libgdk_pixbuf-2.0.so.0`. No shared-host system packages were installed. |

**Activation outcome:** implementation supports explicit Wallet opt-in, but §10
acceptance is **not fully signed off** until the real-wallet check and Firefox
writes pass. Do not silently count either as synthetic/Chromium coverage. The
operator documentation exposes opt-in with this warning; no installation was
switched and no application gate/default was changed by P4.

### Owner-pending compatibility steps

1. Use an isolated HTTPS installation with its own hostname, the same code and a
   privately issued invitation (or a pre-bound test EOA). Never use the owner's
   production database or submit a real private key/seed phrase to Vessel.
2. In a real browser-wallet extension, choose an ordinary EOA and connect it to
   a **non-mainnet** network. Record wallet/version, browser/version and network.
3. Choose the extension from Vessel's wallet selector. Inspect the displayed
   signed message: exact installation origin/URI, Chain ID 1, nonce and expiry,
   sign-in purpose and no transaction/approval/gas. No network switch is needed.
4. Sign, redeem the private invitation if prompted, create the journal and reach
   the shell. Sign out/sign in again. Link a second EOA through linked-wallet
   step-up and its own link signature. Never record invitations, signatures or
   cookies in the acceptance record.
5. Record date and actual outcomes here. Separately run
   `verify-release.py --auth wallet --browser-module <external-playwright>`
   with both browser runtimes available (the default engine set is
   `chromium,firefox`). Revalidate the writes, isolation and revocation checks.

### Browser prerequisites and exact blocked attempt

External tools were installed with
`pnpm --dir /tmp/vessel-pw add @noble/curves @noble/hashes` (both 2.4.0), never
as app dependencies. `pnpm --dir /tmp/vessel-pw exec playwright install firefox`
downloaded revision 1509 but reported missing host libraries. The bounded launch
probe also failed before opening a page:

```sh
node - <<'JS'
const { firefox } = require('/tmp/vessel-pw/node_modules/playwright');
(async () => { const browser = await firefox.launch({ headless: true }); await browser.close() })()
  .catch(error => { console.error(error.message); process.exitCode = 1 });
JS
```

Raw error: `browserType.launch: Host system is missing dependencies to run
browsers.` The missing system sonames are listed in the checklist. Firefox
writes were **not run** and are not a pass. The smoke supports both engines and
defaults to both; this run explicitly selected Chromium because of the launch
failure. Playwright's Firefox installer pruned the older shared Chromium cache;
the supplied revision-1243 Chromium/headless-shell caches were restored from the
official download, and the supplied shell launched and ran the smoke successfully.

## Deliberate limits and remaining work

- The development `pnpm db:migrate` helper remains journal-only plus messaging
  provisioning, not a complete Wallet bootstrap. The packaged `/app/migrate`
  sequence is the verified identity/journal/bootstrap path for this delivery.
- No WalletConnect, smart-contract wallet verification, user/journal deletion,
  admin journal browsing or venue signing/trading.
- Public market-data backoff and Lighter's process-local semaphore are not a
  global cap on all venue HTTP calls. In-memory per-user API limits are per
  API process; account-run capacity and venue deadlines are database-wide.
- The two historical integrity foreign-key audits identified in §9.1 remain
  outside this delivery. A pending real-wallet/browser acceptance is not an
  authorization to broaden scope or apply any owner migration.
- Restore is an offline, trusted-record reconciliation, not merely session
  revocation: an older backup can resurrect wallets, roles and invitations.
  Unconfirmed users stay suspended. Never change owner GUIDs to bypass recovery.
