# Foundation implementation state

September 30, 2026. The owner authorized scaffolding and delegated frontend/backend work to Sol agents. Perpetuals-first for every venue and simultaneous active plays on the same account/instrument are confirmed.

## Implemented

| Area | Foundation delivered |
| --- | --- |
| Frontend | React/Vite/strict TypeScript, feature-owned sample workspace, shared chart data/overlay types and editable shadcn-derived controls |
| Appearance | Graphite tokens, approved section placement, a bounded entry editor, separate journal and expanded sample entry form |
| API connection | Typed `/api/system` client, runtime password gate, Bearer header, explicit rejection/unavailable/invalid-response handling; token input clears after the connection check |
| Backend | Domain, Application, Persistence, Infrastructure and API projects with tested inward project references |
| Domain heads | Owned Account, perpetual instrument identity and distinct active/closed Play heads |
| Persistence | EF/Npgsql implementation, owner-filtered reads, guarded tracked writes, explicit initial migration and composite owner/account foreign key |
| Concurrent plays | A non-unique owner/account/venue/contract index; real PostgreSQL tests confirm multiple active plays coexist |
| Authentication | Configurable token and seeded owner; missing configuration fails closed, constant-time digest comparison, private endpoint fallback policy |
| Operational routes | Anonymous liveness, protected foundation metadata and protected development OpenAPI |
| Tooling | Exact dependency pins, NuGet locks, root pnpm workspace/lock, SDK pin, local PostgreSQL Compose, check script and CI definition |

The application has no full journal API yet. Persistence contains minimal account/play heads, not every entry, strategy, evidence or execution field from the prototype. Owner query filters and save guards are application defenses, not PostgreSQL row-level security; raw SQL and filter bypass remain privileged.

The API metadata intentionally labels Hyperliquid and Lighter as planned, Quantfury as a candidate and manual records as manual. It does not claim that a venue is connected. Liveness does not establish database readiness.

## Deferred

- Live Hyperliquid/Lighter adapters, spot contracts and historical imports.
- Matching or allocating source orders/fills across concurrent plays.
- Full play lifecycle, entries/exits, versioned strategies and durable journal editing.
- Production numeric contracts and payoff/reconciliation engines.
- Real market data and the final chart renderer.
- Evidence bytes, upload/download authorization and S3-compatible storage.
- Durable jobs, broker decisions, monitoring rules and notifications.
- Persistent login/session policy, token rotation/revocation workflow and multi-user administration.
- Production containers/reverse proxy/TLS and deployment.

No price touch is a fill, and no play is inferred from an account/instrument match. The sample frontend is deliberately not a persistence demonstration: edits reset on reload/disconnect and computed payoff fields remain deferred.

## Package-manager decision

The owner requires pnpm for all JavaScript/TypeScript work. Version 12.8.1 is pinned in root `package.json`; Corepack was used to install it on the development host. Its stable registry publish timestamp, September 28, 2026, was checked against the applicable date.

The repository has one pnpm workspace and root `pnpm-lock.yaml`. No npm/yarn lockfile is used. The upstream package registry remains npm's registry. The explicit same-day release-age exceptions in `pnpm-workspace.yaml` correspond to already-pinned, publication-checked dependency versions; they do not permit all packages to bypass age policy.

## Verification

- `pnpm check` passed the frontend type checks, lint, 29 frontend tests, production build, and backend Release build.
- Backend tests passed **28 cases with no skips**, including four tests against actual PostgreSQL 18, explicit migrations, concurrent plays and owner isolation. The orchestrator added the private fallback-policy regression test after reviewing the delegated implementation.
- The existing prototype's **76 tests** passed unchanged.
- Total test cases across the three suites: **133**.
- Explicit migration to the temporary development database succeeded; EF reported no pending model changes.
- Actual API and Vite proxy requests returned anonymous liveness 200, missing/wrong bearer 401 and authenticated foundation metadata 200. The unknown-route fallback policy was also exercised.
- Temporary verification credentials were not printed or committed; built frontend/API artifacts were scanned for their values.
- Frontend-worker browser checks covered built-asset geometry, scrolling, selection, expanded editing and 390px responsive layout. These do not establish a live production auth workflow or full accessibility compliance.
- Orchestrator T3 live-preview attempts for the new loopback app failed; no live native-browser-to-API login is claimed. Actual HTTP authentication/proxy checks and frontend unit/built-asset checks are reported separately.
- The CI workflow was added; no remote GitHub run or deployment is claimed.

Root `docs/development.md` provides reproducible operation. The database tests migrate isolated random schemas and do not destroy shared data. The verification stack used loopback-only development ports, separate from the unchanged LAN prototype on 5173. Its API/frontend processes, isolated PostgreSQL container and volume, and private temporary credentials were removed after verification; only the pre-existing prototype service was left running.

## Next implementation step

Agree on explicit order/fill attribution for concurrent plays, monitoring lifecycle/latency, import date semantics and the financial/API contracts before implementing venue workflows. The module structure can expand when those use cases need it; no generic portability framework or message broker is required merely by this foundation.
