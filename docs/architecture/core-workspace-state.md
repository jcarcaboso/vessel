# Core workspace implementation

October 1, 2026. The owner requested the main application layout without the Play page and authorized delegated backend/core/Hyperliquid/database work. Subsequent account/portfolio management is recorded in [management state](account-management-state.md); that record supersedes the initial management limitations below.

## Interface

The default frontend opens a Graphite application shell with Overview, Portfolios, Accounts, Activity and Settings. The approved Play workspace and prototype stay separate, with Play navigation marked for later.

- Overview uses known nominal values and persisted account/snapshot/execution counts. Empty states use setup guidance, not invented performance.
- Portfolios and accounts can be created through the authenticated API. New accounts belong to one portfolio; legacy unassigned heads remain valid.
- Accounts can be manual with optional value or Hyperliquid with a public address. Lighter and Quantfury remain deferred.
- Account detail reads latest snapshots and recent fills. Refresh is explicitly requested, not a background job.
- Fills remain unassigned to plays and have no fabricated thesis. Retrospective editing is deferred.
- Mobile navigation supports keyboard close and background inertness. Tables scroll internally.
- The token stays in a session client closure, not storage, URLs or build assets. Disconnect releases it; the password field clears after connection.

The shell lives in `frontend/src/features/workspace/`. Existing Play components are retained but not mounted by the default page.

## Backend

Two Sol workers handled separate core and Hyperliquid scopes. The orchestrator handled contracts, frontend integration, mounted migrations and verification.

- Owner-scoped portfolio/account create, list/read routes, overview, snapshots and fills.
- Migration `20261001071844_CoreAccountPortfolio` preserves the initial foundation migration.
- Owned portfolio, snapshot, position and imported-fill tables extend existing account/play heads.
- Decimal-string DTOs and PostgreSQL numeric storage avoid two-decimal coercion.
- Composite owner foreign keys, query filters and tracked-write guards preserve isolation.
- Account-row locks serialize refreshes; snapshot replacement and fill deduplication are transactional.
- Safe Problem Details and working read-after-create resource locations.
- Provider failure preserves previous successful data.

The reader uses fixed `/info` requests for primary perpetual `meta`, `clearinghouseState` and unaggregated `userFills`. It requires only a public address. One 20-second deadline, bounded bodies/depth, exact numeric checks and safe errors apply. There is no signing or order placement.

## Explicit limits

- Primary perpetual DEX only; spot, other DEXs and contracts absent from current metadata are excluded.
- At most 2,000 fills before filtering; no complete lifetime-history or paging claim.
- Three venue reads are not an atomic snapshot, though persistence is transactional.
- No candle endpoint, persisted instrument catalogue, automated jobs, notifications, images, strategy history or full Play lifecycle.
- Correction and archival policies remain open. Repeated fill identities deduplicate.
- Raw provider JSON is parsed, not stored or returned. Normalized values and source identifiers are retained.
- Dollar-format fields are nominal. Hyperliquid collateral is USDC and quote units may differ; no FX conversion or unified-account valuation is implemented.
- Formatting changes neither stored strings nor API precision. Tiny/large values must not silently become zero or lose digits; historical dates include a year.

Official sources: [info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [perpetual schemas](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals), [contract specifications](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications).

## Local operation

Named-volume PostgreSQL is mounted and both migrations applied, on loopback port 55432. Private development settings live in the ignored root `.env` with mode 600; values are not printed or bundled.

```sh
pnpm db:up
pnpm db:migrate
pnpm dev
```

The runner gives credentials only to the API, not the frontend. API/frontend ports are loopback 5080/5180. Stopping them leaves the database volume. The LAN prototype on 5173 remains unchanged; no new firewall port was opened.

## Verification

- `pnpm check` passed 306 cases: 172 backend, 58 frontend and 76 unchanged prototype tests, with all PostgreSQL cases executed. Type checks, lint, Release build and frontend production build passed.
- Real PostgreSQL tests cover migration upgrade, ownership, concurrent deduplication and rollback. Provider tests use fixtures, not live wallets.
- HTTP checks created isolated-owner records and verified exact decimals, partial/unknown values, validation, owner isolation and the live proxy. Only the test owner's rows were removed.
- Browser layout checks used built assets in a temporary static preview with synthetic responses and a fake token. These are separate from real HTTP checks; no live browser-to-provider login is claimed.
- The temporary preview exposes neither a proxy nor private credentials and is removed afterward. No remote CI run or production deployment is claimed.
- Native fixture checks covered the empty and populated shell, account navigation and detail, plus 390px/320px navigation and internal table scrolling. An absolute screen-reader label initially widened the mobile page; positioning its scroll container fixed that overflow.

See [the shared contract](core-workspace-contract.md), [development setup](../development.md), and `backend/README.md`.
