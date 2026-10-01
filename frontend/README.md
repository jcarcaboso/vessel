# Vessel frontend

React/Vite/TypeScript with Graphite and editable shadcn-derived controls. The default page is the main application shell, not the Play editor. `features/plays/` and the separate `../prototype/` remain for later Play integration.

## Run and check

Always use the root pnpm workspace and lockfile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The root development runner reads private server settings from the ignored `.env` for the API only. PostgreSQL must be mounted/migrated for core routes; see `../docs/development.md`. The frontend uses loopback port 5180 and proxies `/api` and `/health` to 5080. `VESSEL_API_TARGET` is a server-only proxy override, never a token.

```sh
pnpm --filter vessel-frontend typecheck
pnpm --filter vessel-frontend lint
pnpm --filter vessel-frontend test
pnpm --filter vessel-frontend build
```

## Current interface

- Overview, Plays, Portfolios, Accounts, Activity and Settings, with collapsible Graphite desktop navigation and a keyboard-closeable mobile drawer. Desktop collapse uses a 78-pixel icon rail with accessible labels/tooltips and retains its state across shell navigation; mobile keeps the full drawer.
- Real owner-scoped portfolio/account creation and lists, latest snapshots and recent execution rows.
- Manual values can remain unavailable. Hyperliquid takes a public address only; the form must not truncate long key-shaped input into an address.
- Manual account refresh, honest error states and retention of previous records if a provider call fails.
- Imported fills are unassigned facts, not inferred plays, thesis or performance.
- The account detail shows venue-reported positions. A missing snapshot is not proof of zero exposure.
- Dollar-formatted record values are nominal. No FX/fair-value or unified-account valuation is provided.
- Plays opens a blank editable local draft using the approved layout, an explicit chart placeholder and existing account/portfolio context. Drafts survive shell navigation, but page reload or disconnect discards them. Play persistence and financial calculations are not implemented. Hyperliquid instrument choices use a metadata-only API read; manual labels are explicit fallback. Direction uses green/up Long and red/down Short, and leverage uses whole multipliers.

Historical dates include the year. Decimal amounts remain strings in API data and form payloads. Formatting passes the original decimal string to `Intl.NumberFormat`, so grouping and rounding are exact for large/negative totals; `Number` only estimates magnitude so tiny values keep significant digits instead of rounding to zero.

Portfolio/account management now includes rename/delete, optional portfolio assignment, move/unlink and disable/re-enable. Disable retains data but hides imported movements/positions. Unassigned accounts appear only in All accounts. Portfolio deletion keeps accounts; account deletion requires confirmation and is blocked by linked Plays.

Account settings saves send the `settingsRevision` loaded with the form as `expectedRevision`. A 409 conflict disables Save, refreshes the shell in the background and offers an explicit reload of the current name/portfolio/enabled state and revision (including portfolios created elsewhere). Stale changes are never replayed. Creating an account for an already-recorded venue address returns 409 and the dialog stays open with the server's guidance.

The shell Reload button reports progress and passes its generation to account detail, so snapshot/fill reads retry even when Overview metadata is unchanged. Server failures (5xx) show a generic message plus `Reference: <trace id>` only when the `X-Correlation-ID` header matches the server's 32-hex format; that ID matches the server's diagnostic log event. The venue-refresh 502 message is used only for account refresh.

## Authentication

The connection gate validates `/api/system`, then retains a private `WorkspaceApi` client closure for this session. Bearer headers are used for subsequent owner-scoped requests. The password field clears after success/failure; the token is never stored in browser storage, URLs or a frontend environment variable. Disconnect releases the client.

Production requires HTTPS and a deliberate same-origin API/proxy. The dev proxy is not a production deployment. The frontend rejects redirects, validates response shapes, and does not display raw provider/server error bodies.

## Structure

- `src/pages/WorkspacePage.tsx` composes the connection gate and application shell.
- `src/features/workspace/` owns page navigation, overview, account/portfolio forms and account-detail/history views.
- `src/api/` owns typed requests, response validation and safe errors.
- `src/features/connection/` owns session connection and disconnection.
- `src/features/plays/` owns the prototype-aligned local draft workspace, venue/manual instrument picker, direction toggle, entry editor, journal and context panels. Previous sample data remains an unmounted reference.
- `src/components/chart/` retains reusable instrument/candle/overlay types and sample renderer; no real candle API is enabled yet.
- `src/components/ui/` holds editable Button/Input/Dialog/Tabs derived from the official shadcn registry, with MIT notice retained.
- `public/fonts/` has the local Manrope font and OFL license. No remote font request is needed.

This slice adds no router/global-state/form/chart library. Hash navigation and feature-owned React state cover the current pages.

## Verification and provenance

The root integration check runs TypeScript, lint, tests and production build. Tests cover draft editing, authentication, core contracts, owner-safe request bodies, decimal/null semantics, forms, navigation, failure recovery, mobile close/focus and format limits.

Native browser layout checks use clearly synthetic fixtures separately from actual API/PostgreSQL verification. These are not proof of a live user wallet session or full accessibility compliance.

Direct versions remain pinned, and the root `pnpm-lock.yaml` owns dependency resolution. `package-provenance.json` records pnpm 12.8.1, Node 24.19.0, lock SHA-256 and npm-registry publication metadata as checked September 30, 2026. That original dependency audit remains applicable because this step added no packages. It covers 384 unique package/version pairs across package-manager and workspace lock documents; peer-qualified snapshots are not counted as extra registry versions. No npm/yarn lockfile is used.
