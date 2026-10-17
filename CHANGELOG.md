# Changelog

## Unreleased

### Changed (breaking)

- Order identity: Play order links now reference Vessel's internal order ID,
  and a venue order ID is unique per account and instrument rather than per
  account. Fills belong to an order by account, instrument and venue order ID,
  so a fill can never be attributed to a Play on another instrument. The same
  venue ID on two instruments becomes two orders, and an order reported on a
  different native market fails closed instead of being overwritten. The
  `execution.filled` dedup key uses the internal order ID. API and event
  payloads keep the venue `orderId`. See
  [docs/architecture/order-identity.md](docs/architecture/order-identity.md).
- **Database:** the `OrderIdentity` migration has no backfill and refuses to
  run when imported orders, fills or Play order links exist. Recreate the
  database before applying it.

## 0.2.0 - October 16, 2026

Release notes: [docs/releases/v0.2.0.md](docs/releases/v0.2.0.md).

### Added

- Background Play monitor: a separate `worker` service (same API image,
  `/app/worker`) checks accounts with active venue Plays or pending linked
  orders every 10 minutes by default, imports fills and orders, links what
  matches and moves Plays to Open or Closed without an open browser. Check
  in the account detail or the Play's Execution tab requests an extra run
  (202, with a server-enforced cooldown); account Refresh stays synchronous.
- Discrepancies: missing, cancelled, short or excess stop protection, orphaned
  stops, targets and entries after a Play ends, plan drift, venue positions
  that disagree with open Plays and unlinked fills. They are flagged and
  dismissable, never corrected; subjects that stay unobservable for 7 days
  become `unverifiable`.
- Events: every Play, execution, link, discrepancy and monitor change is
  recorded in PostgreSQL in the same transaction and published once to a
  RabbitMQ topic through a Wolverine outbox; subscriptions catch up from the
  database. The browser follows them through an authenticated SSE stream with
  an opaque `{epoch}.{sequence}` cursor and reloads stored state only.
- Linked exits and entries of closed or cancelled Plays stay watched until the
  venue shows they no longer rest, or end `unverifiable` after 7 days.

### Changed

- All database writes go through one unit of work; object-storage writes
  refuse to run inside a database transaction.
- `POST /api/plays/{id}/execution/check` no longer reads venues: it records the
  same request as `POST /api/accounts/{id}/monitor/run` and answers 202.
  Opening a Play or a browser timer never reads a venue.
- Adapters report omitted executions (unverified fees, unreported PnL,
  unrecognized contracts); a run with omissions is degraded and its fill-based
  discrepancy checks are unknown.

### Upgrade

- New services: `rabbitmq` (set `RABBITMQ_USER` and `RABBITMQ_PASSWORD` in
  `.env`; optional least-privilege `RABBITMQ_APP_USER`/`RABBITMQ_APP_PASSWORD`)
  and `worker`. AMQP stays unpublished; the management page binds to loopback.
- Migrations `20261016110000_VesselEvents`, `20261016110100_AccountMonitor`,
  `20261016110200_MessagingDeployments`, `20261016110300_PlayDiscrepancies` and
  `20261016110400_PlayDiscrepancyUnverifiable` apply after v0.1.3's
  `PlayDirection`. `migrate` runs them, then `provision-messaging` against a
  healthy `rabbitmq` (envelope storage, broker topology, subscriptions);
  nothing migrates or provisions at API or worker startup.
- Stop web, API and worker for upgrades and backups. Every database restore
  must run `rotate-event-epoch` before provisioning and starting hosts.
  See "From v0.1.3 to v0.2.0" in `deploy/README.md`.

### Known limits

- Checks are periodic (10 minutes by default), not real time; a price touch is
  never a fill.
- No notification channel exists yet; events are delivered to the browser
  stream and recorded for a later Notification Hub.
- Lighter Standard accounts exclude fee-bearing or unverified-fee fills, which
  leaves those checks unknown.

## 0.1.3 - October 16, 2026

Release notes: [docs/releases/v0.1.3.md](docs/releases/v0.1.3.md).

### Added

- Activity pages on the server with a 25 / 50 / 100 rows selector (default 25),
  server-side filters and executions loaded when an operation is expanded. The
  500-operation and 10,000-row response limits are gone.
- Plays list tabs Drafts, In progress, Needs review, Reviewed, Closed, Cancelled
  and All with counts, a title/instrument search and the same pager for ended
  and All views. Overview Plays adds a Drafts tab and shows the five most recent
  Plays per tab.
- Delayed loading skeletons that match the row layout.

### Changed

- The Plays list reads summary columns only; a new `Direction` column
  (migration `PlayDirection`, backfilled from the plan) avoids parsing every
  plan. Apply the migration before starting the new API.
- Overview Plays and recent operations request only the five rows they show,
  with counts from the server.

### Upgrade

- Migration `20261016104756_PlayDirection` adds the column and two list
  indexes. Stop web and API while it runs. Older API images cannot save Plays
  after it is applied; restore the backup to roll back.

### Known limits

- Activity still aggregates every retained fill on each request before paging.
- On a desktop Overview the Plays tabs wrap to two lines.

## 0.1.2 - October 15, 2026

Release notes: [docs/releases/v0.1.2.md](docs/releases/v0.1.2.md).

### Added

- Overview Allocation panel: donuts of each portfolio's share of the total and
  each account's share of its portfolio, following the Overview scope. A View all
  button sits beside the scope; the back arrow and a second click on the selected
  slice always return to All accounts.
- S3-compatible evidence storage. The deployment Compose example now starts a
  private RustFS by default; overlays keep a local folder
  (`compose.storage-local.yaml`) or use an external S3 service
  (`compose.storage-external.yaml`). Invalid S3 settings or outages never fall
  back to local files.
- Offline, dry-run-by-default `evidence-copy-to-s3` and `evidence-copy-to-local`
  API commands that copy and verify originals by size and SHA-256 without
  deleting them or changing metadata or configuration.
- Default Play titles (`BTC Long · 15 Oct 2026`) when saved without a name.
- Accounts grouping by venue or owner address.
- Release workflow: pushing an annotated `vX.Y.Z` tag on `main` runs the checks
  and release verification, publishes both Docker Hub images, moves the latest
  tags and creates the GitHub Release from `docs/releases/vX.Y.Z.md`.

### Changed

- Visual refresh: a readable type scale, a signature accent per theme, lit panels,
  a new mark, a depth-contour texture and ruled journal notes; layout unchanged.
  Graphite's accent moved from `#b9c9e4` to `#9ab5f2`.
- Play journal: one header row, an Expand journal dialog, more default height and
  a Review tab only once a Play is Open, Closed or Cancelled.
- Distinct asset, venue and account in Play lists, and one shared select style.
- Less helper text: pills, info tips, coverage badges shown only when incomplete
  and one "About these numbers" disclosure, keeping required notices.

### Fixed

- The deployment Compose PostgreSQL health check probes TCP, so a first start no
  longer lets migrations connect to the image's temporary init server.

### Upgrade

- No database migration. The one-shot migration service has nothing to apply.
- With no storage settings the API keeps using its original local evidence
  folder. Existing Compose installations that take the new `compose.yaml` must
  add `-f compose.storage-local.yaml` to every Compose command to keep their
  images, or copy them to S3 first with `evidence-copy-to-s3`. Do not point the
  new Compose default at an older API image.
- Linux amd64 image tags are `skorcius/vessel:api-0.1.2` and
  `skorcius/vessel:web-0.1.2`.

### Known limits

- Lighter and manual accounts store no owner address, so grouping by address
  lists them together in one group without an address.

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
