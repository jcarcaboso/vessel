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
| P4 deployment/docs | Explicit Wallet Compose overlay (Token default unchanged), operator settings/CLI/upgrade/restore runbooks, developer references, packaged `--auth wallet` check and external noble-signed browser smoke. | Claude Opus 5.5 reviewed `0988a1b`: **ready-with-fixes**, no blockers. Scoped follow-up fixes and rerun evidence below; no independent re-review is claimed. |

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

**Initial P4 run passed: 128 packaged assertions plus 10 Chromium assertions.** Matrix:
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

### P4 review-fix rerun — October 18, 2026

Claude Opus 5.5's review of `0988a1b` was **ready-with-fixes**, no blockers.
The scoped follow-up preserves the signer and application code, adds the
fail-before-migration auth preflight and persistent Compose mode/overlays,
clarifies activation/recovery and strengthens the smoke/restore assertions.

| Command / check | Result |
| --- | --- |
| `python3 -m unittest discover -s scripts -p 'test_*.py'` | **74 passed**, zero failures. Includes preflight/order/negative readiness tests, browser image option/precheck, network/publish/read-only mounts/resource limits/secret exclusion, endpoint stripping and cleanup order/failure cases. |
| `python3 scripts/verify-release.py` | **152 packaged assertions passed**: HTTP 44, TLS 47, image 5, monitor 26, restore 12, security 8, worker 10. Default Token regression, S3/RustFS. |
| Exact Wallet command in **Manual Wallet pre-release step** below | **129 packaged + 10 Chromium + 10 Firefox = 149 assertions passed**. Matrix: TLS 44, image 5, monitor 26, restore 12, security 8, wallet 24, worker 10. Chromium **153.0.8010.12** local; Firefox **146.0.1** remote. |
| Three `docker compose config --format json` resolutions, private temporary synthetic `.env` | **22 assertions passed**: Token default on migrate/API/worker; bare Wallet commands retain TLS+Wallet overlays and default `Closed`; explicit omission of the overlay retains Wallet mode but lacks origins (preflight refuses before migrations), not Token downgrade. |
| `python3 -m py_compile scripts/verify-release.py scripts/test_release.py`; `node --check scripts/wallet-browser-smoke.cjs`; `sh -n deploy/migrate`; `git diff --check` | Passed. |

The restore rerun now positively proves that the restored operator session is
live (`revoked_at IS NULL`, count 1) **on the restore project before reset**.
Reset then revokes it and its old cookie returns 401. Browser checks inspect
both issuing Set-Cookie headers (no Domain) and stored secure host cookies.

The first remote-server attempt failed with
`browserType.connect: WebSocket error: socket hang up`: rootless Docker's
published TCP proxy accepted connections before Playwright's Node server was
listening. It was a harness readiness race, not a browser/app failure. The
check now waits for `/json` with its exact random `wsEndpointPath`; a regression
test covers the initial disconnect. A standalone isolated probe then reported
`firefox 146.0.1`, and the full command passed in both browsers. The whole-smoke-
inside-container fallback was **not used**.

Both standalone probe containers/networks, all three packaged run project bases
(including the failed remote attempt), restore stacks and temporary API/web
image tags were removed. The final audit found **zero** remaining `vessel-check-*`
containers, volumes or networks, and no image tags for the three run bases.
Only the requested reusable Playwright image was retained, digest
`sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d`.
Logs are `/tmp/vessel-mu/p4-review-{token,wallet,wallet-final,python-tests}.log`;
no operator installation, live database, frontend/backend file or `.github`
workflow changed. Nothing was pushed or published.

## Contract §10 activation checklist

| Gate | Outcome / evidence |
| --- | --- |
| Isolation suite | **PASS:** 66 isolation cases, zero skips, focused Token/Wallet rerun plus full backend run. |
| Two-owner worker/events | **PASS:** focused 120-case isolation/multi-owner/scope-inventory run and full backend suite; includes `MultiOwnerWorkerTests`, `MultiOwnerEventTests`, `MultiOwnerMessagingTests` and `MultiOwnerMonitorLimitsTests`. |
| Revocation of already-open streams | **PASS:** latest Chromium **14,172 ms**, Firefox **13,305 ms** (≤15 s + 5 s margin), using frontend bodyless session DELETE and an independent already-open SSE reader. Smoke asserts the reader is still open immediately before revocation and elapsed time is nonnegative; backend identity/stream/isolation cases also passed. |
| HTTPS cookies | **PASS:** packaged HTTPS check plus Chromium and Firefox inspect both binding/session `__Host-` cookies, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. Browser storage is checked before signing (binding) and after authentication (session), and both issuing response headers must omit Domain. |
| Restore reset | **PASS:** packaged backup had a live operator session; revocation happened after the dump; reset ran offline after restore; the resurrected cookie returned 401, then a new signature authenticated the preserved operator GUID. |
| Real-wallet compatibility, including non-mainnet EOA | **OWNER-PENDING**; exact acceptance steps below. Synthetic noble signatures are not a real-wallet compatibility test. |
| Wallet writes in Chromium | **PASS:** ten Chromium browser assertions: EIP-6963/invitation/shell, POST, frontend profile PATCH, bodyless DELETE, multipart evidence, step-up recovery link, two-user isolation, open-stream revocation and sign-out; zero page/CSP errors or external calls. |
| Wallet writes in Firefox | **PASS: Firefox 146.0.1**, remote official `mcr.microsoft.com/playwright:v1.58.2-noble` server, Playwright 1.58.2 client/server. All ten browser assertions passed, including real Wallet-mode POST, frontend PATCH, bodyless DELETE and multipart, both secure cookies, step-up, isolation, revocation and sign-out; zero page/CSP errors or external calls. Exact command below. The local-host dependency failure is superseded, not counted as a pass. |

**Activation outcome:** implementation supports explicit Wallet opt-in, but §10
acceptance is **not fully signed off**: Firefox has passed, while the real-wallet/
non-mainnet EOA check remains **OWNER-PENDING**. Keep registration **`Closed`**
until both pass and are recorded here. Synthetic signatures do not satisfy the
human check. The operator documentation exposes opt-in with this warning; no
installation was switched. P4 changes the deployment overlay's default
registration to `Closed`, not the application registration constant/default.

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
5. Record date and actual outcomes here. Separately rerun the exact manual
   pre-release command below. Revalidate both browsers' writes, isolation,
   cookies and revocation checks; synthetic coverage never replaces steps 1–4.

### Manual Wallet pre-release step (not a CI gate)

CI gates Token mode only. Before a release, manually run the packaged Wallet
check and both browser smokes against the disposable stack. The deployment
overlay defaults registration to `Closed`; the synthetic check explicitly
selects `Invitation` only in its private disposable `.env`.

```sh
# One-time reusable image prerequisite (no host browser libraries installed):
docker pull mcr.microsoft.com/playwright:v1.58.2-noble
export NOBLE_MODULE_DIR=/tmp/vessel-pw/node_modules
export CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
python3 scripts/verify-release.py --auth wallet \
  --browser-module /tmp/vessel-pw/node_modules/playwright \
  --wallet-browsers chromium,firefox \
  --wallet-browser-image mcr.microsoft.com/playwright:v1.58.2-noble
```

Client/server Playwright are both 1.58.2. The official browser server runs as
`pwuser`, with 2 GiB/2 CPU limits, on the disposable Compose project network,
published only on `127.0.0.1`. Read-only mounts contain `/tmp/vessel-pw` and one
0644 Node forwarder, never the private `.env`/key-ring directory. The forwarder
binds `127.0.0.1` and `::1` at the isolated HTTPS port and routes to `tls:443`.
Firefox keeps the exact `https://localhost:<port>` origin; the isolated internal
CA uses `ignoreHTTPSErrors`, never weakened cookie assertions. Invitations stay
in the local smoke's environment, not Docker arguments or browser-server
environment. Server removal precedes Compose teardown, including failure paths.

### Browser prerequisites and superseded local-host failure

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
browsers.` Missing sonames included `libXcursor.so.1`, `libgtk-3.so.0`,
`libgdk-3.so.0`, `libpangocairo-1.0.so.0`, `libpango-1.0.so.0`,
`libcairo-gobject.so.2`, `libcairo.so.2`, `libgdk_pixbuf-2.0.so.0`.
That original attempt did **not** run Firefox writes and was never a pass.
The follow-up uses the official container instead; no shared-host system
packages were installed. Playwright's Firefox installer pruned the older shared Chromium cache;
the supplied revision-1243 Chromium/headless-shell caches were restored from the
official download, and the supplied shell launched and ran the smoke successfully.

## Deliberate limits and remaining work

- The timing-sensitive frontend comparison in
  `frontend/src/features/identity/sign-in-machine.test.ts` (two `new Date()`
  fixtures built a millisecond apart) is fixed on D1 (`08d07e7`): the unchanged
  signing state is now compared with the same fixture. P4 changed no
  frontend/backend source or tests.
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
