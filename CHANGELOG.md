# Changelog

## Unreleased

- Overview Allocation panel: donuts of each portfolio's share of the total and
  each account's share of its portfolio, following the Overview scope.

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
