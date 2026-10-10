# Application development

The application core lives in `frontend/` and `backend/`. Overview, portfolio/account management, persisted snapshots and recent fills use the protected core API. The approved Play UX remains separate in `prototype/` and is not mounted by the default app.

## Tooling

- Node 24, selected by `.nvmrc`, with the engine constraint in root `package.json`.
- pnpm **12.8.1**, pinned in root `package.json`.
- .NET SDK **10.0.302**, pinned in `global.json` with patch roll-forward.
- Docker with Compose for the local PostgreSQL service.

Always use pnpm for JavaScript/TypeScript work. There is one workspace and one root `pnpm-lock.yaml`, not npm or yarn lockfiles. The npm registry may still be the upstream package source; that does not mean npm is the package manager.

If Corepack is available:

```sh
corepack enable pnpm
corepack install
pnpm --version
pnpm install --frozen-lockfile
```

For a user-writable shim directory, as used on this NixOS host:

```sh
corepack enable pnpm --install-directory "$HOME/.local/bin"
corepack prepare pnpm@12.8.1 --activate
```

The tool was installed locally through Corepack during setup. Use a current Corepack or the official pnpm installation method when the selected Node distribution does not include Corepack; do not silently substitute another package manager. The root `pnpm-workspace.yaml` explicitly allows the already-reviewed pinned packages released within pnpm's default age window; there is no blanket release-age exemption.

## PostgreSQL

Copy `.env.example` to the ignored root `.env`, set a private local database password and a random API token, and keep the file private. The development runner supports KEY=value entries and optional matching quotes, not shell commands. Then:

```sh
pnpm db:up
```

The development service binds **only `127.0.0.1:55432`**. It uses PostgreSQL 18 and a named volume. These database credentials and privileges are for local development, not a production security configuration.

Set the backend connection in your process environment or secret manager:

```text
ConnectionStrings__Vessel=Host=127.0.0.1;Port=55432;Database=vessel;Username=vessel;Password=YOUR_LOCAL_PASSWORD
```

Do not commit the populated value. Migrations are deliberate:

```sh
cd backend
dotnet tool restore
dotnet ef database update --project src/Vessel.Persistence
cd ..
```

The API does not migrate at startup. `pnpm db:migrate` reads server connection settings from root `.env` and applies both explicit migrations. The core schema adds owned portfolios, snapshots, positions and imported fills. Its active-play account/instrument index remains non-unique, with composite owner constraints. No complete journal schema or inferred fill association is provided.

## API and token

Configure `Vessel__Auth__Token` privately before connecting. There is no default production token. It is read by the API, not Vite. Never create a `VITE_*` token variable.

Optional owner configuration is `Vessel__Auth__OwnerId` and `Vessel__Auth__OwnerName`. The default seeded identity is documented in [the shared contract](architecture/scaffold-contract.md); it is not a login system or venue credential.

Run:

```sh
pnpm dev:api
```

The development launch profile binds `http://127.0.0.1:5080`.

- `GET /health/live` is anonymous liveness and does not prove database readiness.
- `GET /api/system` requires `Authorization: Bearer …` and reports foundation metadata, including perps scope and planned/manual venue statuses.
- Missing/wrong tokens fail closed. New unannotated endpoints have an authenticated fallback policy.
- Development OpenAPI is also protected.

Lighter read-only tokens are separate from the Vessel API token. Configure a server-only encryption key ring before saving them; public account discovery and reads work without one. See [credential setup, HTTPS and rotation](architecture/venue-credentials.md#operator-setup) and the [implemented import workflow](architecture/lighter-state.md). Never enter a real venue token in the HTTP LAN preview.

Metadata and liveness can run without database connectivity. The protected core endpoints provide portfolio/account create/list/read, overview, snapshots, fills and bounded manual-trigger Hyperliquid refresh. There is no full Play CRUD, job scheduler or full-history backfill.

## Frontend

In a second terminal:

```sh
pnpm dev:web
```

Or start both processes from the root with `pnpm dev`. That runner reads private API/database values from root `.env` and does not pass them to the frontend. `pnpm db:up` and `pnpm db:migrate` are explicit setup steps; the API does not migrate implicitly. Use Ctrl+C to stop the runner while retaining PostgreSQL.

Open `http://127.0.0.1:5180`. The Vite development proxy forwards `/api` and `/health` to the API. `VESSEL_API_TARGET` can override the server-side proxy target; it is not a token or a browser configuration secret.

Enter the configured backend token at runtime. The field clears after connection; the API-client closure keeps the token only in session memory for protected reads/writes, until disconnect. Nothing stores it in browser storage, a URL or the build.

The default page uses actual core API records, with honest loading/empty/error states. Manual values may be unavailable. Hyperliquid refresh covers primary-perpetual state and bounded recent executions. Imported fills remain unassigned; there is no invented thesis, FX adjustment or complete-lifetime claim. Plays can be saved with revisions and lifecycle status, link imported orders and fills, render venue candle charts with drawings and indicators, and keep evidence images; unsaved drafts stay in browser memory. Background jobs and notification delivery remain later work. See [the Plays contract](architecture/plays-workspace-contract.md), [Play lifecycle](architecture/play-lifecycle.md) and [portfolio review](architecture/portfolio-review.md).

These HTTP addresses are loopback development endpoints. A real self-hosted deployment needs HTTPS and deliberate proxy/authentication policy.

Outside `Development`, the API refuses to start unless `Vessel__Auth__Token` is a generated secret of at least 32 characters, `ConnectionStrings__Vessel` is set and any `Vessel__Auth__OwnerId` is a GUID. `/health/live` reports the process; `/health/ready` (anonymous, no details) returns 200 only when the database answers and every migration is applied. After 20 wrong tokens within 10 minutes, further wrong tokens from that client address receive 429 with `Retry-After` until the window ends; the right token keeps working so a shared proxy address cannot lock the owner out. Only loopback proxies may set `X-Forwarded-For`/`X-Forwarded-Proto`; put the TLS-terminating proxy on the same host or configure trusted proxies before relying on them. API responses carry `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` unless an endpoint sets its own policy. The existing LAN prototype at `10.1.0.219:5173` remains separate; the scaffold does not automatically open firewall ports.

## Current LAN review

October 1, 2026: the owner requested the actual frontend/backend preview on the LAN and explicitly requested a development-only authentication token.

- Application URL: **http://10.1.0.219:5180/**
- Frontend listener: `10.1.0.219:5180`, not all interfaces.
- API listener remains `127.0.0.1:5080`; the frontend's same-origin `/api` and `/health` proxy reaches it.
- PostgreSQL remains loopback-only at `127.0.0.1:55432`.
- User service: `vessel-lan-preview.service`.
- A subnet-specific NixOS firewall rule allows TCP 5180 on `ens18` from `10.1.0.0/24` to `10.1.0.219`.

The separate preview token override lives in ignored `.env.lan-preview`, mode 600. It is used only by the API process, not compiled into the frontend or copied into documentation. The original `.env` token and database password are unchanged and were not disclosed. The owner received the preview token explicitly for development access; future secret disclosure is not authorized by that exception.

The preview is HTTP development access, not a production deployment. Anyone given the token can use this single-owner development workspace. Do not reuse the preview token for production or expose this service to the internet.

```sh
systemctl --user status vessel-lan-preview.service
systemctl --user restart vessel-lan-preview.service
systemctl --user stop vessel-lan-preview.service
```

The service is transient and is not configured to return after a host reboot. The firewall rule also disappears after a firewall reload/reboot. Stopping the service does not delete the database volume.

To recreate the service on this machine after it is unloaded, retain the private preview environment file containing the token override, `Vessel_DEV_HOST=10.1.0.219`, and a `PATH` containing the user-installed pnpm shim:

```sh
systemd-run --user --unit=vessel-lan-preview \
  --description='Vessel actual app LAN development preview' \
  --property=WorkingDirectory=/home/ops/projects/vessel \
  --property=EnvironmentFile=/home/ops/projects/vessel/.env.lan-preview \
  --property=Restart=on-failure --property=RestartSec=3 \
  --property=TimeoutStopSec=35 \
  -- "$(command -v python3)" /home/ops/projects/vessel/scripts/dev.py lan
```

`pnpm dev:lan` uses the same runner but requires an explicit private `Vessel_DEV_HOST` in its process environment. The default `pnpm dev` remains loopback-only. A systemd user manager may not inherit the interactive shell's `~/.local/bin`; without the preview file's explicit `PATH`, pnpm is not found.

Check or add only this rule:

```sh
sudo iptables -C nixos-fw \
  -i ens18 -s 10.1.0.0/24 -d 10.1.0.219/32 -p tcp --dport 5180 \
  -m comment --comment vessel-app-lan-preview -j nixos-fw-accept ||
sudo iptables -I nixos-fw 1 \
  -i ens18 -s 10.1.0.0/24 -d 10.1.0.219/32 -p tcp --dport 5180 \
  -m comment --comment vessel-app-lan-preview -j nixos-fw-accept
```

To remove it, use the same match with `iptables -D nixos-fw`. This does not change the separate prototype rule on port 5173.

Verification included actual LAN page/liveness HTTP 200, missing/wrong bearer API 401, authenticated system/overview with mounted database 200, and a real T3 browser login into the Overview without synthetic responses. No wallet refresh or order request was made.

### October 5 SL/TP frontend comparison preview

The original `10.1.0.219:5180` frontend still served an October 4 revision when checked on October 5. The current agent host (`10.1.0.230`) has no authorized SSH access to update that service.

An additional transient user service, `vessel-sl-tp-preview.service`, serves the latest-main frontend plus the SL/TP display correction at **`http://10.1.0.230:5180/`** from the `t3code-dcce987b` worktree. Its server-only `VESSEL_API_TARGET=http://10.1.0.219:5180` forwards protected API requests through the existing preview. Connect with the existing API token; no token, database configuration or private environment was copied. Stop it with `systemctl --user stop vessel-sl-tp-preview.service`.

This is a frontend comparison preview, **not an upgrade of the original backend**. Newer API capabilities such as sizing suggestions still require updating and migrating the original backend with authorized access. The database, original service and firewall were left unchanged. SL/TP controls were browser-verified separately with a disposable, clearly labeled fixture that made no account/API requests.

## Checks

```sh
pnpm check
```

That runs the existing prototype tests, locked NuGet restore, backend Release build/tests, frozen pnpm install, TypeScript checks, lint, frontend tests and production build.

Set `Vessel_TEST_POSTGRES` to a real PostgreSQL test connection to execute database integration tests. Without it, 40 PostgreSQL tests explicitly skip; an invalid supplied connection fails. Tests migrate unique temporary schemas and drop only those schemas, not the shared database. The CI definition supplies a separate ephemeral PostgreSQL service.

Useful focused commands:

```sh
pnpm --filter vessel-frontend typecheck
pnpm --filter vessel-frontend lint
pnpm --filter vessel-frontend test
pnpm --filter vessel-frontend build
dotnet test backend/Vessel.slnx --configuration Release
```

CI is defined in `.github/workflows/checks.yml`. Local execution does not establish that a remote GitHub run succeeded; no push is implied.

Hyperliquid account detail now has supported stablecoin total/held/available wallet rows, separate from its primary perpetual snapshot. Use Refresh account to populate old snapshots. See [stablecoin wallet limits](architecture/stablecoin-wallet.md).

## Later work

Perpetuals-first and simultaneous active plays are confirmed. The core reader imports recent primary-DEX fills only. Complete backfills, source corrections, order/fill allocation, full Play lifecycle, payoff rules, scheduling, evidence and notification delivery need further specification. See [current core state](architecture/core-workspace-state.md).

See [MVP alignment](architecture/mvp-alignment.md), [the scaffold contract](architecture/scaffold-contract.md), and the per-directory READMEs for implemented boundaries.
