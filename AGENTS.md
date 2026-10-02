# Vessel

Read `docs/project-brief.md` and `CONTEXT.md` before changing product terminology or scope.

The current phase is core application development following foundation scaffolding, architecture alignment and visual discovery. The owner initially approved a static image, then requested a browser prototype served on the LAN. The disposable implementation lives in `prototype/`; see `docs/prototype.md` for scope and operation. Do not treat sample interactions as production features. Play is provisional terminology.

The owner has now locked the side-by-side desktop layout. Preserve the positions of the chart, position editor, journal, capital context and summary while exploring visual design. The responsive stack is shared by all variants. Ten dark skins live in `prototype/themes.mjs` and `prototype/themes.css`, with a comparison page at `/designs.html`. Do not create separate app implementations or move sections merely to differentiate themes. Check both palette contrast and rendered controls after changing styles.

September 30, 2026: the owner approved Graphite as the default and configurable themes as a future product capability. The final baseline enlarges the journal, bounds the scrolling entry sidebar and adds an expanded entry editor. Read `docs/design/approved-baseline.md` before revisiting those decisions. Backend and frontend direction now follows the MVP alignment record, not the disposable prototype. The browser smoke checks are in `prototype/tests/browser-smoke.mjs`.

The owner's React/Vite/TypeScript and ASP.NET Core 10/PostgreSQL direction is specified in `docs/architecture/proposal.md`, supported by `docs/architecture/runtime-persistence-research.md`. `docs/architecture/mvp-alignment.md` records confirmed self-hosted single-user/token scope, Hyperliquid-first integration, manual venues, retrospective reviews and notification direction. On September 30, 2026 the owner authorized scaffolding with Sol agents, confirmed perpetuals-first for all venues and allowed multiple simultaneous active plays on the same account/instrument. Follow `docs/architecture/scaffold-contract.md` for the bounded foundation step and shared API contract. Frontend and backend workers have disjoint write scopes. Later jobs/broker, chart renderer, monitoring/matching and media implementations still need specification. Do not treat a price touch as a fill, invent a thesis for imported history, enforce a unique active play per account/instrument, or reverse dependencies by putting business-facing contracts in concrete infrastructure.

October 1, 2026: the owner authorized the main application shell without mounting the Play page, plus core account/portfolio and read-only Hyperliquid work. Follow `docs/architecture/core-workspace-contract.md` and `core-workspace-state.md`. Overview uses real core API data; Plays was initially disabled pending separate authorization. First refresh covers bounded primary-perpetual state and recent fills, not full history or a background job. Keep unknown values null, exact strings intact, currency/coverage limits visible and fills unassigned. The mounted local database and ignored `.env` are development-only; never expose their values through Vite, logs or chat.

October 1, 2026, after PR #1 merged: the owner authorized the Plays page, components and approved layout with delegated Sol work. Follow `docs/architecture/plays-workspace-contract.md`. Plays is an editable in-memory draft workspace, not persisted Play CRUD. Preserve the approved section positions and bounded/expanded entry editor. Chart rendering and research are deferred to the last step; no sample candles, financial calculation claims, automatic budget derivation or fill assignment. The owner subsequently requested a read-only Hyperliquid primary-perpetual catalogue, explicit manual fallback, green/up Long and red/down Short, whole-number leverage and closer prototype fidelity; these refinements are in the same contract. Shell navigation retains drafts; reload and disconnect discard them.

Account/portfolio management is specified in `docs/architecture/account-management-contract.md` and verified in `account-management-state.md`. Unassigned accounts use null portfolio and exist only in All accounts, not a seeded default tile. Disable preserves imports but hides their activity/positions and blocks sync. Portfolio deletion unlinks without data loss; account deletion removes retained facts only after explicit confirmation and is blocked by linked Plays. Preserve owner scope and account/sync locking. The owner requested a first-part PR before starting Play implementation.

October 1, 2026, after PR #2 merged: the owner chose Lightweight Charts with Vessel-built tools and authorized the chart first pass. Follow `docs/architecture/chart-plan.md`. Candles are bounded, owner-scoped Hyperliquid trade candles with manual refresh; manual instruments keep the placeholder; dragged levels keep their own units. October 2: drawing tools are implemented as time/price-anchored drawings kept per instrument in the in-memory draft. Live updates stream through a backend SSE relay over one shared Hyperliquid WebSocket (observations only, never fills). October 2, after PR #3 merged: chart captures and uploaded images with notes live in the draft (browser memory) until Plays can be saved; the server stores evidence only for saved Plays through a configurable `IEvidenceObjectStore` (local filesystem now, S3-compatible later), configured under `Vessel:Evidence` in the API appsettings. Images can be marked up with vector shapes (pen, marker, arrow, box, text) kept beside the untouched original; marked is the default view. See the captures section of the chart plan.

Stablecoin balance scope is in `docs/architecture/stablecoin-wallet.md`. Perps-first still applies to instruments/executions; spot/unified wallet reads are allowed for supported stablecoins only. Keep wallet total/held/available distinct from primary perps equity, withdrawal and collateral, and never double-count ledgers. Validate token identities against metadata and preserve exact values/nominal caveats. Do not implicitly add EVM, lending or non-stable valuation.

## Project tracking

- Repository: https://github.com/jcarcaboso/vessel
- Plane origin: https://kanban.testing.alpetxino.com
- Plane workspace: working-projects
- Plane project ID: `5eb5e953-f5ab-45c4-8b44-57c19512520d`
- Plane identifier: `VESSEL`
- Plane project: https://kanban.testing.alpetxino.com/working-projects/projects/5eb5e953-f5ab-45c4-8b44-57c19512520d/issues
- Outline origin: https://outline.testing.alpetxino.com
- Outline collection ID: `e8abc489-516e-44ac-8bf7-73c0d6a3f5be`
- Outline document ID: `0301d392-9dde-417c-93f9-72cf72f35325`
- Outline document: https://outline.testing.alpetxino.com/doc/vessel-edURkJD0Hp

Use the manage-project skill when starting or completing tracked work. Read the linked card and context first. Update Plane with verified progress or blockers and Outline when useful knowledge changes. Report failed remote updates explicitly.

The existing Trading Diary project points to a different GitLab repository. Do not carry its architecture, requirements, or task states into Vessel.

## Package manager

Use pnpm for all JavaScript/TypeScript package operations, never npm or yarn. The exact pnpm version is pinned in root `package.json`; the workspace uses one root `pnpm-lock.yaml`. Use Corepack if pnpm is not installed. .NET packages continue to use the .NET CLI and NuGet lockfiles.
