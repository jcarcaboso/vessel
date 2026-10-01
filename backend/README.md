# Vessel backend core workspace

This is the bounded account/portfolio workspace, not a complete journal implementation. The API exposes anonymous `GET /health/live` and bearer-protected `GET /api/system` with the same camelCase response shape, stage `core` and Hyperliquid status `read-only`. No database connection is needed to start the API or serve those two routes. Core workspace routes require PostgreSQL with explicit migrations.

The shared contracts are `docs/architecture/core-workspace-contract.md` and `docs/architecture/account-management-contract.md`. Financial DTO fields are invariant exact decimal strings, with null for unknown balances. A known zero remains zero; partial portfolio coverage stays explicit. Account record counts include disabled accounts; portfolio values and coverage use enabled accounts only.

## Projects

- `Vessel.Domain`: owner-scoped portfolios, accounts, latest snapshots/positions and imported fill facts, plus distinct play heads and perpetual contract identity. Active and Closed are minimal head states, not the final execution-driven lifecycle.
- `Vessel.Application`: journal owner context, system metadata, workspace use cases/DTOs, persistence port and normalized read-only venue port.
- `Vessel.Persistence`: EF Core/Npgsql mapping, workspace store, owner filters/write guard/composite constraints, migrations and design-time factory.
- `Vessel.Infrastructure`: bearer authentication, HTTP owner context, Hyperliquid reader and registration.
- `Vessel.Api`: composition and routes. Development OpenAPI is at `/openapi/v1.json` and requires the same bearer.

Business code does not reference concrete infrastructure. Application owns the bounded store/read contracts; Persistence implements EF access. No generic repository, Play CRUD, inferred execution matching, background jobs/broker, order placement or notification implementation is included.

## Core routes

All core routes require the bearer and derive ownership from its server-configured identity, never request body fields:

- `GET/POST /api/portfolios`: list portfolios or create `{ name }`.
- `GET/POST /api/accounts`: list accounts or create `{ portfolioId, name, venueId, address?, manualAccountValueUsd? }`. The optional `portfolioId` may be null/omitted for an unassigned account, or must identify an owned portfolio. No default Portfolio row is created. Venues are `manual` or `hyperliquid`.
- `PATCH /api/portfolios/{id}`: rename with `{ name }`, returning the updated portfolio. Names are trimmed, nonblank and at most 200 characters.
- `DELETE /api/portfolios/{id}`: 204 after transactionally unlinking every account, including disabled ones. It changes only their nullable `PortfolioId`, never `OwnerId`, balances, snapshots, fills or Plays.
- `PUT /api/accounts/{id}`: full settings `{ name, portfolioId, isEnabled }`, returning the updated account. All three JSON properties are required, including an explicit null for unlinking. Missing/invalid fields return 400 without mutation. Venue, address, source identity and manual values are not editable here.
- `DELETE /api/accounts/{id}`: hard delete with 204, removing retained imported fills and the latest snapshot/positions. Any linked Play, active or closed, blocks deletion with safe 409; trading intent and facts remain intact.
- `GET /api/accounts/{id}`: metadata remains available for disabled records; every account DTO includes `isEnabled`.
- `GET /api/accounts/{id}/snapshot`: latest observation, or literal JSON `null` before a refresh. Missing/foreign accounts return 404.
- `GET /api/accounts/{id}/fills`: at most 100 recent fill facts; `playId` is always null.
- `POST /api/accounts/{id}/sync`: bounded, synchronous Hyperliquid refresh only. Manual or disabled accounts return 400.
- `GET /api/overview`: portfolios, accounts, known-value totals, counts, recent facts and scope notice.

Hyperliquid uses a public hexadecimal address only. Composition supplies a typed HttpClient with fixed `https://api.hyperliquid.xyz/` base, `/info` requests and a 20-second timeout; HTTP-client logging is disabled. No endpoint URL, signing key or venue secret comes from the request. The reader covers primary perpetual DEX state and bounded recent fills, not complete account equity or lifetime history.

Disabled accounts stay in management lists and record counts, but their venue positions and imported fills are excluded from overview, normal activity and detail routes. Snapshot GET returns literal JSON `null`; fills GET returns `[]`. The database retains these facts unchanged, and enabling the account exposes them again. Activity filtering happens in SQL before the latest-100 limit, so hidden fills cannot displace visible facts. Overview financial totals, valued-account count, imported-fill count and position count use enabled accounts only. With no known enabled value, totals remain null, not zero.

A PostgreSQL account-row lock serializes same-account refreshes across processes. Settings and hard deletion acquire the same account lock and reload tracked settings after waiting. A disable/delete cannot be overwritten by an in-flight refresh. Owner-scoped transaction advisory locks serialize grouping mutations before account locks, avoiding assignment/delete lock-order inversions without serializing independent-account syncs. Portfolio deletion also locks the portfolio row and its accounts before unlinking, so foreign-key locking protects against dangling assignments. Lock waits remain subject to normal PostgreSQL command timeout/request cancellation; there is no background queue. The transaction atomically replaces the latest snapshot/positions, inserts only new account/contract/source-ID fill facts and records sync metadata. The unique composite fill index provides a second deduplication guard. Provider failure commits a generic error status without changing the last successful snapshot, positions, fills or observation timestamp. Raw provider JSON is not persisted or returned. Validation/missing resources/linked-Play conflicts/provider failures use safe Problem Details (400/404/409/502); unavailable persistence returns a generic 503. The API does not log exception/provider payloads.

## Configuration and running

From the repository root:

```sh
dotnet restore backend/Vessel.slnx --locked-mode
dotnet build backend/Vessel.slnx --no-restore
dotnet run --project backend/src/Vessel.Api
```

The development launch profile binds `http://127.0.0.1:5080`. A deployment can use normal ASP.NET Core URL configuration. No unrestricted CORS policy is enabled.

Set secrets in the process environment or an ignored local configuration, never in tracked files or frontend builds:

| Environment variable | Meaning |
| --- | --- |
| `Vessel__Auth__Token` | Required bearer secret. No built-in token. Missing or blank configuration rejects protected requests with 401. |
| `Vessel__Auth__OwnerId` | Optional seeded owner UUID. Defaults to `11111111-1111-1111-1111-111111111111`. An empty UUID fails authentication. |
| `Vessel__Auth__OwnerName` | Optional seeded display name. Defaults to `Owner`. Blank names fail authentication. |
| `ConnectionStrings__Vessel` | PostgreSQL connection for persistence and migration tooling. |
| `Vessel_TEST_POSTGRES` | Separate connection used only by real PostgreSQL tests. |

The seeded owner is configuration-backed, not a persisted login or broker account. Client request fields cannot change it. Token failures are generic and the application does not log bearer values. New unannotated routes have an authenticated fallback policy; anonymous liveness is an explicit exception. Do not enable middleware or proxy logging that records Authorization headers.

## Explicit migrations

The API does not create or migrate tables at startup. Set `ConnectionStrings__Vessel`, then run from `backend/`:

```sh
dotnet tool restore
dotnet ef database update --project src/Vessel.Persistence
```

The design-time factory reads the connection environment variable directly and does not start the API or require its token. To inspect SQL without opening a database:

```sh
dotnet ef migrations script --project src/Vessel.Persistence
```

To add a later deliberate schema change:

```sh
dotnet ef migrations add ChangeName --project src/Vessel.Persistence --output-dir Migrations
```

The immutable initial migration creates only `accounts` and `plays`. `20261001112809_AccountManagement` adds non-null `IsEnabled` with database default true for existing and new accounts; it changes no numeric columns or Play constraints. `20261001071844_CoreAccountPortfolio` extends it with nullable portfolio/address/manual-value/sync metadata and adds `portfolios`, `account_snapshots`, `account_positions` and `imported_fills`. Existing accounts remain unassigned with unknown balances; legacy manual heads gain `manual` status and other venue heads `not-synced`. Decimal columns use PostgreSQL `numeric` without a two-decimal typmod, preserving .NET decimal precision. Each head has an owner UUID. A composite owner/account foreign key prevents cross-owner links even in direct SQL. The owner/account/venue/contract index is non-unique, so multiple active plays can coexist. No play is automatically matched to an execution or netted venue position.

Owner query filters and the save guard apply to ordinary context use. The guard rejects tracked foreign heads, including records deliberately loaded via `IgnoreQueryFilters`. This is not PostgreSQL row-level security. Raw SQL, bulk EF operations and filter bypass are privileged persistence operations, not owner-safe application APIs.

## Tests

```sh
dotnet test backend/Vessel.slnx
```

Without `Vessel_TEST_POSTGRES`, the twenty-three PostgreSQL tests are reported as skipped with the environment variable named in the reason. Domain, dependency and WebApplicationFactory tests still run. No in-memory provider substitutes for PostgreSQL.

With `Vessel_TEST_POSTGRES` set to a real PostgreSQL connection, the tests require CREATE/DROP SCHEMA permissions. Each test applies actual migrations (including a foundation-to-core upgrade case) in a random `vessel_test_<uuid>` schema, uses that schema as its search path, and drops only that schema on disposal. They never recreate or delete the shared database or dev tables. An invalid supplied connection fails the tests rather than skipping them. Use a test database in CI.

Coverage includes concurrent same-owner/account/contract active plays, second-owner and unrelated-owner query isolation, cross-owner write rejection, and the PostgreSQL foreign key. API tests cover missing/wrong/malformed credentials, missing server configuration, default/configured owners, camelCase metadata, anonymous liveness, protected development OpenAPI and secret-free auth logs.

## Package pins

Registry package metadata was checked on September 30, 2026. All 73 unique locked packages and the EF tool were checked against NuGet registration metadata. All are listed, non-prerelease versions with publish timestamps before October 1, 2026 UTC. Direct and transitive dependencies are locked in each project's `packages.lock.json`.

| Package/tool | Version | Published UTC |
| --- | --- | --- |
| Microsoft.EntityFrameworkCore | 10.0.10 | 2026-07-14 |
| Microsoft.EntityFrameworkCore.Relational | 10.0.10 | 2026-07-14 |
| Microsoft.EntityFrameworkCore.Design | 10.0.10 | 2026-07-14 |
| Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | 2026-07-10 |
| Npgsql, transitive | 10.0.3 | 2026-05-27 |
| Microsoft.AspNetCore.OpenApi | 10.0.10 | 2026-07-14 |
| Microsoft.OpenApi | 2.12.2 | 2026-08-20 |
| Microsoft.AspNetCore.Mvc.Testing | 10.0.10 | 2026-07-14 |
| Microsoft.NET.Test.Sdk | 18.10.1 | 2026-09-15 |
| xunit | 2.9.3 | 2025-01-08 |
| xunit.runner.visualstudio | 3.1.5 | 2025-09-27 |
| dotnet-ef | 10.0.10 | 2026-07-14 |

Npgsql's 10.0.3 nuspec supports EF Core `[10.0.4, 11.0.0)` and depends on Npgsql 10.0.3. EF/ASP.NET 10.0.10 matches the observed installed runtime supplied by SDK 10.0.302. NuGet publication dates were verified independently of the host SDK. Relational is explicitly pinned so API and tests do not resolve Npgsql's minimum 10.0.4 against Persistence's 10.0.10. The direct OpenAPI 2.12.2 pin replaces ASP.NET OpenAPI's vulnerable 2.0.0 minimum without moving to a new major.

Primary verification sources are the NuGet flat-container indexes and package nuspecs, the Npgsql EF provider package registry entry, and advisory GHSA-v5pm-xwqc-g5wc. NuGet audit remains enabled; vulnerability warnings are not suppressed.

For reproducible provenance, the registry endpoints are:

```text
https://api.nuget.org/v3/registration5-gz-semver2/{lowercase-package-id}/{version}.json
https://api.nuget.org/v3-flatcontainer/{lowercase-package-id}/index.json
https://api.nuget.org/v3-flatcontainer/{lowercase-package-id}/{version}/{lowercase-package-id}.{version}.nupkg
https://api.github.com/advisories/GHSA-v5pm-xwqc-g5wc
```

Registration responses provide `published` and `listed`; the downloaded package nuspec provides framework and dependency ranges. Checking only the flat-container version list would not establish the publication date.


Core-specific checks include API authentication/body validation/exact JSON shapes, manual and public-address account creation, null/partial balances and coverage, owner isolation, actual foundation upgrade, snapshot replacement, fill deduplication within a response/across concurrent refreshes/across accounts and contracts, safe provider failure preserving prior data, and mock-reader refresh through the real API against PostgreSQL. Adapter fixtures never call arbitrary real accounts. No live provider or frontend integration test is claimed by the backend suite.


Management tests cover nullable/omitted creation, required full-PUT properties, rename/move/unlink/source preservation, foreign targets/destinations, disabled-only/partial coverage, hidden history filtering before limits, retained data restoration, explicit core-to-management migration, portfolio unlink retaining active Plays and facts, hard delete cascading imported facts while preserving other owners/accounts, and active/closed Play protection. Concurrency checks observe actual PostgreSQL lock waits with gated fixture reads, covering sync versus disable/account-delete/portfolio-delete, stale tracked settings, and concurrent create/move versus portfolio deletion. These tests use only isolated random schemas; running the suite does not migrate the mounted development schema. Main owns explicit migration rollout and frontend/LAN integration.

## Stablecoin wallet update

`20261001125452_StablecoinWallet` persists a separate owner-scoped HyperCore stablecoin wallet for USDC/USDE/USDT0/USDH identified by exact token IDs. Refresh also queries account abstraction and spot metadata/state. This adds balance reads, not spot trades. Available is total minus held, not collateral/withdraw guarantee. Primary perps and wallet ledgers are never added as equity. Six calls share20s; nominal string sums preserve exact precision. Old observations remain unknown until refreshed. See `../docs/architecture/stablecoin-wallet.md`.
