# Vessel frontend

React, TypeScript and Vite client for the same-origin Vessel API. Read the
[frontend guide](../docs/architecture/frontend-guide.md) for module structure,
state ownership and feature contracts. The [frontend review](../docs/architecture/frontend-review.md)
tracks architecture work.

## Run locally

Use the Node range and pnpm version in the root `package.json`. From the
repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

Vite listens on `http://127.0.0.1:5180` and proxies `/api` and `/health` to
`http://127.0.0.1:5080`. To use another local API:

```sh
VESSEL_API_TARGET=http://127.0.0.1:5081 pnpm dev:web
```

`VESSEL_API_TARGET` is a server-only proxy setting, not a token. See the
[development instructions](../README.md) for starting the API. Installing,
checking or building the frontend does not require a database or venue access.

## Check

Run these from the repository root:

```sh
pnpm --filter vessel-frontend typecheck
pnpm --filter vessel-frontend lint
pnpm --filter vessel-frontend test
pnpm --filter vessel-frontend build
```

Tests use synthetic fixtures. They do not verify a live wallet or replace
browser checks of the approved desktop layout, responsive stack and themes.
See the [verification record](../docs/product-review/verification/2026-10-14-frontend.md)
for browser evidence and remaining gaps.

## Security

- Keep the owner bearer token in the session client closure only. Never put it
  in URLs, browser storage, frontend environment variables or logs.
- Owner financial responses use `no-store`. The candle cache is session-only
  and must not survive reload, disconnect or API replacement.
- Use the same-origin API for venue reads. The production browser must not call
  venue APIs directly. Vessel does not place orders or treat price touches as fills.
- Validate API responses and show safe errors, never raw provider or proxy bodies.
- Require HTTPS for production. Vite's development proxy is not a production
  deployment. Read-only venue credential entry over development HTTP has an
  explicit plaintext warning; it does not relax the production guard.

Release images, HTTPS, explicit migrations and private storage are documented in
[deploy/README.md](../deploy/README.md).
