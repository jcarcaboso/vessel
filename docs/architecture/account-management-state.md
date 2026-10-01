# Account and portfolio management

October 1, 2026. The owner requested rename/delete for portfolios and accounts, disabling imported account activity, moving and unlinking accounts, then a pull request for this first part before Play implementation.

## Behavior

- Accounts may be created with no portfolio. `portfolioId: null` is the virtual unassigned/default grouping, not a stored Portfolio record. These accounts appear in All accounts only and create no portfolio tile.
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

## Verification

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
