# Foundation scaffolding contract

September 30, 2026. The owner authorized delegated foundation scaffolding after confirming perpetuals-first for every venue and allowing multiple active plays on the same account and instrument.

This is the bounded first implementation step, not the completed trading diary. The disposable `prototype/` and its running LAN service remain unchanged.

## Work split

- Frontend worker owns `frontend/`.
- Backend worker owns `backend/`.
- Orchestrator owns root configuration, local development wiring, CI, architecture documentation, verification and project tracking.
- Workers do not change each other's directories or commit independently.

## Shared HTTP contract

Default development API address: `http://127.0.0.1:5080`.

Frontend development server: port `5180`. Its development proxy forwards `/api` and `/health` to the API. The production deployment should use one origin or a deliberate reverse proxy; this scaffold does not enable unrestricted CORS.

Anonymous `GET /health/live`:

```json
{ "status": "healthy" }
```

Bearer-protected `GET /api/system`:

```json
{
  "application": "Vessel",
  "stage": "foundation",
  "owner": {
    "id": "11111111-1111-1111-1111-111111111111",
    "displayName": "Owner"
  },
  "marketScope": "perpetuals",
  "allowsConcurrentPlays": true,
  "venues": [
    { "id": "hyperliquid", "name": "Hyperliquid", "status": "read-only", "source": "evm-address",
      "capabilities": { "sync": true, "instruments": true, "orders": true, "candles": true,
                        "marketContext": true, "stream": true, "stablecoinWallet": true },
      "quoteAsset": "USDC", "tradeUrlTemplate": "https://app.hyperliquid.xyz/trade/{instrument}" },
    { "id": "lighter", "name": "Lighter", "status": "planned", "source": "none", "capabilities": { "all": false }, "quoteAsset": null, "tradeUrlTemplate": null },
    { "id": "quantfury", "name": "Quantfury", "status": "candidate", "source": "none", "capabilities": { "all": false }, "quoteAsset": null, "tradeUrlTemplate": null },
    { "id": "manual", "name": "Manual", "status": "manual", "source": "none", "capabilities": { "all": false }, "quoteAsset": null, "tradeUrlTemplate": null }
  ]
}
```

Since October 5, 2026 the venue list is built from the venue registry and each venue states its capabilities; the abbreviated `{ "all": false }` above stands for the seven capability flags. See [venue-registry.md](venue-registry.md).

The owner UUID is a configurable seeded MVP identity, not a token or a user supplied in API request bodies. The response must not claim that venue integrations are implemented.

Use `Vessel__Auth__Token` for the server-side token, optionally `Vessel__Auth__OwnerId` and `Vessel__Auth__OwnerName` for the seeded identity, and `ConnectionStrings__Vessel` for PostgreSQL. There is no built-in production token. Missing authentication configuration fails closed. A frontend Vite environment variable must never contain the token.

The frontend enters the token at runtime and keeps it in memory only. The token is not persisted in local storage, URLs or the build bundle.

## Backend scope

Use ASP.NET Core 10 with clean dependency direction and feature folders:

- Domain business types and invariants, including perpetual instrument identity and distinct plays.
- Application-owned contracts for authentication context, future venue capabilities and evidence storage only where useful.
- Isolated PostgreSQL/EF/Npgsql persistence with explicit migration tooling.
- Infrastructure registration and a bearer authentication handler.
- API composition, the two routes above and a development OpenAPI document if supported.
- Domain/architecture and API integration tests. PostgreSQL verification must cover two same-owner/account/instrument plays coexisting, and isolation of a second owner's data.

Projects may be grouped by these boundaries rather than create four assemblies per business feature. No generic repository, automatic order matching, live venue HTTP client, scheduler/broker package, full journal CRUD, image service or notification delivery is required in this step.

There must be no uniqueness constraint allowing only one active play per account/instrument. A later matching implementation must use explicit source order/fill identity or confirmation, not silently choose between those plays.

## Frontend scope

React/Vite/TypeScript with a local lockfile, strict type checks, linting and tests. Use editable shadcn-style component code based on current official guidance, with Graphite tokens.

Provide a feature-oriented foundation shell preserving the approved chart/editor/journal/capital/summary placement, not a completed port of every prototype behavior. Sample charts and play fixtures must remain labeled as samples. Reusable chart input/overlay types should not depend on the full Play feature model.

The API connection gate exercises the shared authenticated contract. The page can show seed/sample content after connection, but must not imply that sample edits have been saved to PostgreSQL or sent as broker orders. Type the server response explicitly and test authorization/error handling and a representative UI selection.

Suggested frontend scripts: `dev`, `build`, `typecheck`, `lint`, and `test` with a non-watch test run. The owner requires pnpm for all JavaScript/TypeScript package operations. Root `package.json` pins the tool, `pnpm-workspace.yaml` includes the frontend, and one root `pnpm-lock.yaml` locks dependencies. No npm/yarn lockfile or separate monorepo build tool is required.

## Verification and deferred work

The orchestrator will restore/build/test the backend, install/typecheck/lint/test/build the frontend, exercise auth and API/frontend wiring, verify PostgreSQL behavior, and rerun existing prototype tests. Development secrets belong in ignored local files or process environment and are never returned in logs or chat.

A root local PostgreSQL compose configuration and CI can be added without deploying the production product. New dev processes must not replace the existing LAN prototype or open another firewall port automatically.

Monitoring lifecycle and latency, exact fill assignment, historical-import UX, numeric/API contracts for trading data, final chart renderer, jobs, media and external notification implementations remain later specification work.
