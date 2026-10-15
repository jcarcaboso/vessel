# Changelog

## Unreleased

- Overview Allocation panel: donuts of each portfolio's share of the total and
  each account's share of its portfolio, following the Overview scope.

## 0.1.1 - October 15, 2026

### Added

- Owner-recorded manual executions with partial exits, explicit unknown costs,
  correction history and idempotent writes.
- Preview and confirmation of eligible retrospective Plays from completed
  imported operations, without inventing a pre-trade plan or initial-risk R.
- Structured Play reviews, amendment history and pending/reviewed queues.
- Review exclusion details with the affected Play, order and fill reasons.
- Whole-position planned loss, gain, reward-to-risk and risk-share estimates
  with separate allocation, priced-quantity and exit coverage.
- Read-only Lighter · Robinhood accounts, with separate credential purposes,
  USDG collateral support and bounded history.
- Bundled venue logos, updated account controls and configurable venue hosts.
- Nominal supported-stablecoin fee and result handling across Activity, Review,
  manual executions, sizing and Overview, with explicit 1:1 valuation caveats.

### Fixed

- Execution completeness, exact residual quantities, partial-exit average cost
  and execution-time ordering in lifecycle, Review and sizing calculations.
- Imported order-link roles, retrospective eligibility and atomic account moves.
- Retained order-history coverage, route body limits and pending evidence edits.
- Extreme percentage-derived prices and tiny-price matching tolerances.
- Stale execution and discovery responses, cancellation, polling and evidence
  Blob URL cleanup.
- Unsaved Play exit protection, page error recovery and lazy-loaded pages.
- Typed chart-level precision, generated tick rounding, leverage confirmation,
  light-theme native controls and remaining hard-coded component colours.

### Upgrade

- Apply `20261013190344_DiaryCompletion` with the explicit one-shot migration
  service while web and API are stopped. Back up the database, evidence and
  credential key ring first. API startup never applies migrations.
- Linux amd64 image tags are `skorcius/vessel:api-0.1.1` and
  `skorcius/vessel:web-0.1.1`. Image publication remains an owner-operated step.
- Existing Lighter accounts and tokens remain separate from Lighter · Robinhood.
  Supported stablecoins are valued nominally at 1:1, not at an FX or depeg price.

## 0.1.0 - October 13, 2026

First manual release of the self-hosted, single-owner Vessel application.

- Overview with enabled-account balances, coverage and recent activity.
- Accounts and portfolios, custom portfolio icons, manual accounts, disabling,
  moving and explicit deletion with retained-data safeguards.
- Bounded read-only Hyperliquid, Lighter and RISEx integration. Lighter read-only
  tokens use encrypted server-side storage. No trading orders are submitted.
- Saved Plays, lifecycle status, plan revisions and imported order/fill linking.
- Venue candle charts, drawings, plan/range tools, EMAs, Volume and RSI.
- Journal evidence captures and uploads, notes and vector markup beside originals.
- Portfolio review of closed Plays from linked executions, with coverage limits.
- Sizing suggestions with explicit acceptance and reasoning, not automatic advice.
- Venue-neutral activity operations with expandable executions and filters.
- Settings, built-in dark/light themes and browser-saved custom palettes.
- Production auth hardening, health endpoints and explicitly trusted proxy settings.
- Separate API and web Docker images, explicit migration bundle and Compose example.
- Exact single-hop proxy trust, an optional Caddy TLS overlay with unpublished web,
  static security headers/CSP and backend-only API compression decisions.
- Isolated database/evidence/key-ring restore instructions and local HTTP/TLS,
  browser CSP and restore verification scripts.

Full-history backfills, background monitoring and notification delivery remain
outside this release. Activity operations are not retrospective Plays or inferred
trading intent.
