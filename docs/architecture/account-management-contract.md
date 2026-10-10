# Portfolio and account management contract

October 1, 2026. The owner requested rename/delete portfolios and accounts, disabling accounts to hide imported movements, and moving or unlinking accounts from portfolios.

## Behavior

- Unassigned accounts use `portfolioId: null`, not a seeded/default Portfolio row. They appear in All accounts, not a portfolio tile or individual portfolio filter. Accounts may be created without a portfolio.
- Renaming changes only the display name, not the venue, address, source identity or history.
- Deleting a portfolio unlinks all its accounts, including disabled accounts, transactionally. It never deletes accounts, snapshots, fills or plays.
- Disabled accounts remain visible in account management with a Disabled marker and can be enabled again. Disable preserves all data, blocks refresh, and hides their imported fills and venue positions from normal activity, overview and detail routes.
- Overview/portfolio balances and position/fill counts exclude disabled accounts. Account record counts still include disabled records. UI coverage text must refer to enabled account values rather than imply every record contributes.
- Hard account deletion removes that account's retained imported facts and latest snapshots/positions. Require an explicit confirmation in the UI. If any Play head references it, return safe 409 and retain everything; do not delete trading intent as a side effect.
- Move/unlink does not rewrite imported facts or historical intent. Grouping uses the current account assignment; historical portfolio membership analysis is not part of this step.

## API additions

All routes remain owner-scoped. Unknown/foreign IDs return 404 without revealing another owner's data.

- `PATCH /api/portfolios/{id}`, `{ "name": "New name" }` (optionally with `"icon"`, see Portfolio icons), returns updated `PortfolioDto`.
- `DELETE /api/portfolios/{id}`, returns 204 after unlinking accounts.
- `PUT /api/accounts/{id}`, full settings body `{ "name": "New name", "portfolioId": null, "isEnabled": true, "expectedRevision": 1 }`, returns updated `AccountDto`.
- `DELETE /api/accounts/{id}`, returns 204 or 409 when Plays prevent deletion.
- `CreateAccountRequest.portfolioId` becomes nullable and optional.
- `AccountDto` adds `isEnabled: boolean`; the migration defaults existing accounts to enabled.
- Full account PUT requires all settings properties and `expectedRevision`, including explicit portfolio null. Omitted properties must not silently disable or unlink accounts. `AccountDto.settingsRevision` changes with settings and portfolio-deletion unlinking, independently of sync time. A stale expected revision returns 409 rather than overwrite newer settings.

Existing account DTOs may be accepted temporarily by the frontend during the dev-server rollout with missing `isEnabled` treated as enabled. New API output always includes it.

Disabled account GET detail metadata remains available for management. Snapshot GET returns literal JSON null and fills GET returns an empty list while disabled. No hidden fills should leak through activity limit/count routes. Re-enabling makes retained imported facts visible again.

## Portfolio icons

October 10, 2026. The owner asked for custom portfolio icons.

- Each portfolio has an icon chosen from a fixed set of drawn icons (folder, briefcase, wallet, piggy-bank, landmark, coins, bitcoin, gem, trending-up, chart-line, chart-candlestick, chart-column, target, compass, rocket, zap, flame, timer, hourglass, shield, anchor, mountain, sprout, crown). The default is `folder`, which existing portfolios receive through the `PortfolioIcons` migration.
- Icons are keys, not uploaded images or markup. The server accepts only keys in `PortfolioIcons` (`Vessel.Domain/Workspace/Portfolio.cs`) and returns 400 without changes for anything else; the browser list lives in `frontend/src/features/workspace/portfolio-icons.ts` and must stay in step.
- `POST /api/portfolios` accepts an optional `icon`. `PATCH /api/portfolios/{id}` takes `{ "name": "…", "icon": "…" }`; an omitted or null icon keeps the stored one, so a rename-only client cannot reset it. `PortfolioDto.icon` is always present.
- The new-portfolio and manage-portfolio dialogs show the icons as a radio group; the portfolio tile shows the chosen icon. A key the browser does not know shows the folder. The picker uses theme tokens only, so every theme restyles it without layout changes.

## Concurrency and ownership

Management and sync must coordinate account row locks. A disable/delete cannot be undone by a late refresh, and unlink cannot race portfolio deletion into a dangling FK. Verify target portfolio ownership before changing the account. Portfolio deletion handles concurrent assignments through FK/locking semantics, not an unchecked in-memory cascade.

Write guards, owner-composite FKs and the multiple-active-play non-unique index remain. Use exact decimal strings and don't change venue/public-address metadata through a settings update.

## Tests and deployment

Verify names, nullable create, reparent/unlink, foreign IDs, portfolio deletion retaining data, disabled-history/position exclusion and restoration, refresh blocking, full-PUT missing fields, permanent delete and linked-Play protection, plus actual PostgreSQL migration and concurrent behavior.

The backend worker owns `backend/` and backend tests; the orchestrator owns frontend/root/docs and integration. The existing Hyperliquid adapter and approved Play/prototype layout need no changes. No new packages are required.

Roll out the new explicit migration and rebuilt API to the owner-requested LAN preview only after checks, preserving existing records and the preview token.
