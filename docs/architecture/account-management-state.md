# Account and portfolio management

October 1, 2026. The owner requested rename/delete for portfolios and accounts, disabling imported account activity, moving and unlinking accounts, then a pull request for this first part before Play implementation.

## Behavior

- Accounts may be created with no portfolio. `portfolioId: null` is the virtual unassigned/default grouping, not a stored Portfolio record. These accounts appear in All accounts or its Unassigned filter and create no portfolio tile.
- Portfolios can be renamed. Deleting one transactionally unlinks both enabled and disabled accounts while retaining their data and ownership.
- Account settings change name, optional portfolio and enabled state together. Venue and public address stay unchanged, so imports cannot be relabeled as a different source.
- Disabled accounts remain manageable and can be re-enabled. Their retained imported fills and venue positions are hidden from overview/activity/details; refresh is blocked. Totals exclude disabled records and coverage captions refer to enabled values.
- Re-enabling restores the same retained data. Disabling is not deletion.
- Permanent account deletion needs a second explicit UI confirmation and removes the account's imported history/snapshots/positions. Any linked active or closed Play returns safe 409 instead, retaining all data.
- Rename/move/delete/disable coordinate with sync account-row locks and an owner-scoped management transaction lock. Foreign IDs remain 404; required PUT properties prevent an omitted field silently unlinking or disabling a record.

Current grouping does not reconstruct historical portfolio membership. Execution assignment and Play UI remain later work.

## Implementation

The backend Sol worker updated domain settings, use cases, persistence, endpoints and tests. The orchestrator handled shared contract, frontend management dialogs and actions, migration rollout, integration and publication.

Migration `20261001112809_AccountManagement` adds non-null `IsEnabled` with default true. Existing accounts are not disabled by migration. Earlier migrations, decimal types, ownership constraints and multiple-active-play support are unchanged.

Management API:

```text
PATCH  /api/portfolios/{id}  { name }
DELETE /api/portfolios/{id}
PUT    /api/accounts/{id}   { name, portfolioId, isEnabled }
DELETE /api/accounts/{id}
```

PUT requires all three fields, with explicit null to unlink. Delete returns 204, with 409 when Play history blocks account deletion. `AccountDto` now includes `isEnabled`. Create permits omitted/null portfolio; disabled snapshot is literal null and fills are an empty list.

The Graphite UI uses pencil actions on portfolio tiles and account rows/details. Dialogs explain retention versus permanent deletion, handle safe conflict errors, and preserve source identity. Existing account metadata may temporarily omit `isEnabled` during dev rollout; it is treated as enabled, while the new API always returns it.

## October 13, 2026: membership implementation

Portfolio creation optionally moves existing accounts in the same PostgreSQL transaction. The new authenticated `POST /api/accounts/portfolio` supports owner-scoped all-or-nothing assignment or null unassignment of 1–200 distinct accounts, including disabled records. It uses the existing management and sync row locks, validates every member before changes, bumps revisions only for changed assignments, and retains imported facts. No EF migration was added.

`CreatePortfolioDialog` and `ManagePortfolioDialog` share a searchable, labelled account checklist. Tiles have Add accounts, focused on membership. New account and Lighter import share a New portfolio… destination/name control with retained confirmed creations across failed account requests and slow shell reloads. Accounts has visible-row selection and a bulk move bar; hidden/deleted selections are removed. Success and partial/uncertain failures use the common reload path. Account management now follows current portfolio options even while open.

Managing both additions and removals still uses separate bulk calls after the existing rename/icon request. Each call is atomic; the entire dialog save is not. Both membership endpoints now accept complete per-account `expected` settings revisions. They validate the expectation list and compare every current revision after acquiring all row locks, before any mutation or portfolio creation. A mismatch returns 409 without partially changing membership or revisions. Omitted/null expectations retain unconditional API assignment semantics, but all existing-account membership UI flows use expectations. No read-then-unconditional-unlink remains.

New portfolio and the Accounts bulk bar retain the revisions of selected rows across reloads. Manage portfolio retains displayed revisions for pending checklist edits. Conflicts show explicit messages, request a common shell reload, and discard stale membership selections rather than replay them. The dialogs refresh their account/portfolio lists. Manage also requires Reload accounts before enabling another save and warns that an earlier rename or separate membership request may already have succeeded.

Verification uses synthetic in-memory/API fixtures and disposable PostgreSQL 18 containers. The original membership checks used loopback port 55521; the verification fixes ran against a new `postgres:18-alpine` container on loopback port 36661, stopped after the suite. Tests cover authentication, required nullable target, bounds/duplicates, disabled moves, no-op revisions, stale account PUT, unknown/foreign resource rejection, exact create-with-accounts totals, retention, transaction rollback after a parent save, and waiting for a sync row lock. New regression cases reproduce the two-tab A rev1 → B rev2 move followed by a rejected stale removal, validate complete expectations, and prove no partial bulk changes or rejected portfolio creation. Frontend tests exercise each dialog, failed creation/retry, live option/membership reconciliation, selection pruning, shell reloads, pending controls and strict API validation. The owner's live database and `.env` are untouched.

### Membership checks

- Frontend typecheck, zero-warning lint, all 966 tests (55 files), and production build pass. Membership and verification fixes add 52 frontend cases: 22 dialog/selection tests, 29 API-client cases and one shell reload/tile entry test. The fixes add 15 cases beyond the initial membership implementation.
- Release backend build passes with zero warnings/errors. All 1,086 runnable tests pass, including all 77 PostgreSQL facts; two existing opt-in live-venue probes remain skipped. Membership and verification fixes add 47 backend cases: 24 unit, 15 API and eight PostgreSQL facts. The fixes add 21 cases beyond the initial membership implementation.
- Native browser checks use synthetic fetch fixtures only. The checklist is bounded to a 240px scroll area; account-name and detail contrast exceed 7:1 across all ten built-in themes. The 390px-wide bulk bar with the inline portfolio name does not overflow the page. The production bundle loads without console errors and keeps the chart renderer deferred.
- The attempted eager vendor split was reverted. `frontend/vite.config.ts` retains the existing bundling configuration and the production build emits the existing over-500 kB chunk warning. The warning is accepted for this membership change; no zero-warning production-build claim is made.
- `git diff --check origin/main...HEAD` passes after removing the extra EOF blank line in `usePortfolioDestination.ts`.

## Verification

### October 12, 2026 workspace corrections

Portfolio tiles previously used perps-only `totalValueUsd`, so moving a unified wallet account could leave the displayed amount at zero despite its portfolio balance changing. Tiles now show `balanceUsd` with coverage and the perps/manual subtotal separately. Manager selections hold IDs and reread current response objects, including revision and portfolio membership. Common reloads update tiles, counts, account filters and Plays capital context; explicit null balances are not replaced by perps equity.

Accounts now has combined name/source, venue, enabled/disabled/sync-state and portfolio filters, including Unassigned, with result counts and reset. Accounts and Overview offer sequential capability-driven Refresh all with row spinners, progress, one summary listing failures, and one final shell reload. Settings/sync backend locks and deletion rules are unchanged.

Regression coverage includes the old unified-wallet tile failure, move/disable/enable and revision changes through management dialogs, current Plays capital context, removal of a selected portfolio, filtered bulk refresh with failures and sequential requests, and enabled/unknown/empty/precise backend totals.

### Original verification

- `pnpm check` passed 364 tests: 214 backend, 74 frontend and 76 unchanged prototype cases.
- New backend management coverage is 42 cases, including 11 actual PostgreSQL tests. Existing 12 PostgreSQL cases also ran. Checks cover disable/restore, required fields, source retention, owner isolation, deletion cleanup, linked-Play conflict and lock waits in both sync/management orders.
- Frontend tests cover full settings requests, nullable create, 204 deletes, conflict handling, confirmation/cancel, rename/move/unlink/enable/disable, no default tile and portfolio filtering.
- Isolated-owner real HTTP checks exercised management and linked-Play protection. Only test-owner records were removed; no real wallet refresh was triggered.
- Native LAN browser checks created disposable manual records, renamed a temporary portfolio, moved/disabled/unlinked/re-enabled the temporary account, inspected hidden movements and deleted only those temporary records.
- The migration is applied to the mounted database and the LAN service restarted with the same private preview token. The app remains available at `http://10.1.0.219:5180/`.
- Typecheck, lint, production build, package audit and source secret scans passed. No full accessibility or production-readiness claim is made.

## First-part PR

The repository was empty remotely. The existing approved visual baseline commit is published as the `main` base without replacing remote history, and the checked foundation/core/management changes go on `feat/core-workspace-management`.

The PR includes TypeScript/React/Vite/shadcn foundation, modular ASP.NET Core 10/PostgreSQL, read-only Hyperliquid core, application shell, account/portfolio management, explicit migrations, pnpm tooling, CI and architecture/reference documentation. It excludes private environment files, credentials, build/dependency artifacts and the next Play implementation.

See [the management contract](account-management-contract.md), [core limits](core-workspace-state.md) and [development setup](../development.md).
