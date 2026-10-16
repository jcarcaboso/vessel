# Play monitor: development plan

October 14, 2026. Status: **implementation authorized on October 14, 2026, with Sol implementation and independent verification, final isolated end-to-end checks and stacked pull requests.**

The owner asked to shape a background monitor before building it. The monitor watches active Plays at their venues, detects fills, checks stops and targets against the real venue position and moves Play status automatically. Every change raises an event. A later, platform-independent notification system consumes those events: Telegram first, Discord later, and in-app popups. This is step 4 of the [Play lifecycle](play-lifecycle.md#monitoring-and-notifications). Building notifications is out of scope; the event contract is designed for them.

## What the owner has settled

- **Periodic, not real time.** Each monitored account is checked every 10 minutes by default; 20 or 30 minutes are acceptable.
- **Outbox plus broker.** Events are written to PostgreSQL in the same transaction as the Play change, then relayed to RabbitMQ (or a similar broker) so the system can scale later. W0 recommends Wolverine 6.50.0 with the integration conditions below; the owner authorized implementing this direction after the unit-of-work refactor.
- **A separate worker from the start.** The monitor runs in its own process and container, not inside the API.
- **Positions are compared.** The account sync already stores the venue's positions, so each run compares them with the open Plays.
- **Late events are delivered while still relevant**, and are marked so consumers can treat them differently.
- **Alerts on a Play's drawings** (price crossing a drawn line or level) are wanted, but they need near-real-time prices and a different path. Deferred; see [Price and drawing alerts](#price-and-drawing-alerts-deferred).
- **Tracking lives in the repository.** No Plane or Outline.

Settled on October 14 after the first draft:

- **Interval:** configurable, starting at 10 minutes.
- **Protection grace:** configurable, starting at 10 minutes. After it, an open position without protection is shown as an issue.
- **Worker packaging:** the worker ships in the API image with its own entrypoint, like `migrate`.
- **Event retention:** configurable, starting at 90 days for every event type. Play history, imported facts and deduplication records remain separate; pending delivery work is not silently deleted.
- **Browser checks on demand only.** The worker still checks automatically at the configured interval. Opening a Play does not request an extra run. The Check button is blocked while a run is pending or running and then for a configurable cooldown, shown as a countdown. The server enforces the same rule, so repeated presses or several tabs cannot queue extra venue reads.
- **Check cooldown:** 60 seconds by default, configurable, measured from completion including failed attempts.
- **Closed-Play follow-up:** keep checking linked exits after closure or cancellation at the normal interval until fresh venue evidence confirms they are no longer resting. Dismissing a warning does not stop those checks. Account-disable and credential guards still apply.
- **RabbitMQ management page:** exposed for now, for troubleshooting.
- **Wolverine fit is checked first** (W0 spike) before any product work. W0 is complete with a conditional-go recommendation. Subsequent implementation authorization is recorded above.
- **Unit of work first.** After W0, the owner chose a bounded unit-of-work refactor to centralize saves and transaction completion before integrating Wolverine. The top-level use case owns the boundary; nested stores do not commit or dispatch. Necessary intermediate saves remain inside the same transaction.

Unchanged rules:
- Venues are read-only.
- A price touch is never a fill.
- Linking is automatic only when unambiguous.
- Discrepancies are flagged, never silently corrected.
- Code checks capabilities, never venue names.
- Owner scope applies everywhere.
- Values stay exact decimal strings.
- Secrets never appear in logs, URLs or messages.
- Migrations are explicit and never run at startup.
- Tests never touch the owner's database.

## Where things stand

- **Transitions are browser-driven.** `PlayExecutionService.CheckAsync` runs only when the browser calls it: when a Play is opened, and every 60 s while a tracked Play is visible. It syncs the account (snapshot and fills), reads orders, links them and applies transitions under the `vessel-execution:{account}` advisory lock. `LinkAsync` (owner confirmation) also applies transitions. With no tab open, nothing is detected.
- **Venue reads hold a database lock.** `WorkspaceService.SyncAsync` makes its venue calls inside the account row lock (`SELECT … FOR UPDATE`).
- **Coverage is not machine-readable enough yet.** `VenueOrderReadResult` has orders, one observation time and a notice, but no complete-open-orders flag. Add explicit adapter coverage before interpreting an absent order as missing protection. A human-readable notice is not a safe completeness contract.
- **No background jobs exist** apart from the Hyperliquid market stream relay. There is no scheduler, job runner or broker.
- **Owner scope comes from the HTTP request.** `VesselDbContext` filters every query by `IJournalOwnerContext`, and the only implementation, `HttpJournalOwnerContext`, reads the request.
- **Release layout.** The release image runs the API and carries the `/app/migrate` bundle. Compose runs postgres, migrate, api and web.

## Architecture

```text
 browser ──REST/SSE──► API ───────────┐                ┌──────── Worker ────────┐
 (owner links,          │ commands,   │                │ scheduler              │
  Check now)            │ owner events│                │ RunAccountMonitor      │──► venue REST (read-only)
                        ▼             ▼                │ later: Telegram,       │
              PostgreSQL ◄── outbox ── RabbitMQ ──────►│ Discord consumers      │
              (record)       relay     (transport)     └────────────────────────┘
```

- **`Vessel.Worker`** (new project) is a generic host with no HTTP ingress. It hosts the scheduler, the account monitor and, later, the notification consumers. It uses the same Domain, Application, Persistence and Infrastructure modules as the API.
- **The API** stops reading venue orders for Plays. It appends events for owner actions (link, confirm, unlink, dismiss), sends `RunAccountMonitor` commands, and consumes events to push them to the browser.
- **RabbitMQ is transport, not the record.** Everything needed to rebuild state lives in PostgreSQL.

### Dependency rule

Application defines the ports. Infrastructure messaging adapters integrate with Persistence's transaction boundary; Domain and Application never reference Wolverine or RabbitMQ. The ports are:
- `IUnitOfWork`: execute a database write operation on the shared owner-scoped context, save and finish its transaction.
- `IPlayEventSink`: append an event to the current unit of work.
- `IMonitorCommands`: request a run for an account.
- `IMonitorClock` or `TimeProvider`.

W0 recommends keeping Wolverine behind these ports rather than writing a replacement outbox. See [the fit investigation](wolverine-fit-research.md) for tested versions and limitations.

### Unit of work and transaction boundary

W0 reproduced Vessel's real nested account-row/advisory-lock transaction and multiple inner saves. It proved that saving and outbox dispatch must remain separate from transaction completion. The owner then chose a unit of work to own that boundary instead of adding commit hooks to individual stores.

- Application declares `IUnitOfWork` with an `ExecuteAsync` boundary and no EF or Wolverine types. Its implementation reuses the scoped `VesselDbContext`; it does not add a second change tracker or a generic repository framework.
- The top-level write use case starts one unit of work. Stores acquire the existing owner-scoped account/management/advisory locks and change entities inside that transaction. Nested services participate without starting or completing another unit of work.
- Centralize `SaveChangesAsync`, commit and rollback in the implementation. Stores no longer independently commit or send messages. Preserve write-owner validation, concurrency conflict handling and lock ordering.
- One transaction may still need intermediate database saves. `WorkspaceStore.SaveRefreshAsync` currently removes position/wallet rows before inserting replacements with the same composite keys; reconciliation saves imported orders before querying them for matching. Keep those necessary saves behind the unit-of-work persistence implementation. They do not commit, dispatch or expose partially committed state.
- The final monitor path reads venues before opening the database transaction, then reloads and validates account/source/credential revisions under the locks. A transaction retry must not repeat network calls. The first refactor preserves the existing import/reconcile commit boundaries; moving network reads and changing admission happens in the worker step with its revision checks.

Once outbox integration is added, the completion sequence is:

```text
Begin database transaction
  Acquire locks and revalidate state
  Apply changes and collect events
  Persist business events and outgoing envelopes on the same transaction
  Save remaining changes
Commit once
Attempt outgoing-message dispatch
```

Do not call `SaveChangesAndFlushMessagesAsync()` inside an existing store callback. In the tested version it commits the current transaction, and the spike reproduced a business change surviving an intended rollback. Calling `FlushOutgoingMessagesAsync()` before outer commit is also unsafe: the consumer acted on a change that subsequently rolled back.

The scoped event sink requires an active unit of work. Rollback discards pending in-memory sends and ends the failed work; it must not leave tracked mutations available for a later accidental save. Dispatch happens only after successful commit. A post-commit broker error does not roll back the business operation or justify repeating it; its durable envelope remains for recovery. Do not mix Wolverine-owned transaction middleware with Vessel's unit-of-work boundary.

### Records and transport

| Store | What it holds | Written |
|---|---|---|
| `play_events` (Vessel table) | The event history: what the UI, catch-up and republishing read | Same transaction as the Play change |
| Outbox envelope (Wolverine, PostgreSQL) | The copy waiting to be sent to RabbitMQ; removed once the broker confirms | Same transaction |
| Inbox envelope (Wolverine, PostgreSQL) | Incoming message IDs; duplicates are rejected | On receipt |
| `event_deliveries` (Vessel table) | Per event and consumer: delivered, skipped, expired or failed, with attempts | By each consumer |
| RabbitMQ queues | Messages in transit | By the relay |

- **Broker recovery.** PostgreSQL holds the retained events and durable consumer receipts. A republish sweep can recover an empty broker for those consumers, using the same event IDs. Pending manual monitor requests also live in PostgreSQL, so command recovery does not depend on an event row. Queues and bindings must exist before publishing; a publisher acknowledgement alone is not a consumer receipt. Broker volume backups are optional only after this recovery path has passed the release test. Lost broker diagnostics are not reconstructed.
- **At-least-once delivery.** A receipt is unique per owner, event and consumer. Database-only consumer effects and their receipt commit together. An external send followed by a crash can still repeat after retry; restoring an older database can also lose receipts for messages already sent. The later notification plan must handle those limits rather than promise exactly-once delivery.
- **Catch-up cursor.** A fixed overlap does not make an ordinary database sequence safe against a transaction that commits late. Proposed implementation: serialize event-number allocation through one owner cursor row, held until the event transaction commits. Allocate near the end of the transaction, in a consistent lock order, with no network calls. Readers can then advance safely. Broker messages only wake a reader; the reader drains committed rows in cursor order. A cursor outside retained history, or ahead of a restored database, returns an explicit reset requiring a state reload.
- **Retention:** `Vessel:Events:RetentionDays`, default 90 for every event type, confirmed by the owner. A daily worker task deletes terminal events and their delivery rows in bounded batches. It does not silently remove pending outbox work or unresolved durable deliveries; expiry is an explicit terminal outcome. Event deduplication/baseline records must survive history pruning so an old fill cannot become a new event. A Play's history does not depend on events: status changes, plan revisions, links, fills and discrepancies keep it.

## Deployment

- **Compose services:** postgres, **rabbitmq** (new), migrate, api, **worker** (new), web.
- **Worker image:** the worker ships in the API image with its own entrypoint (`/app/worker`), as `migrate` does today. Releases keep the `api-x.y.z` and `web-x.y.z` tags.
- **RabbitMQ:**
  - official `rabbitmq` 4.x management image, pinned;
  - AMQP not published;
  - the management page published for troubleshooting, bound to loopback by default (`VESSEL_RABBITMQ_MANAGEMENT_BIND`, default `127.0.0.1:15672`, like `VESSEL_WEB_BIND`). Reach it through an SSH tunnel or behind the TLS proxy; never plain HTTP to the internet;
  - credentials from `.env`, with the default `guest` user unusable remotely;
  - healthcheck `rabbitmq-diagnostics -q ping`;
  - a named volume for durable queues, excluded from backups;
  - quorum queues on a single node;
  - both publisher-confirmation switches enabled explicitly;
  - durable exchanges, queues and topic bindings provisioned before producers start. W0 confirmed that an unbound topic can be acknowledged and removed from the outbox without delivery. Confirmations do not replace topology validation or consumer receipts;
  - plain AMQP inside the private Compose network, the same trust boundary as API → PostgreSQL today. TLS is required if the broker ever leaves the host.
  - Upgrades follow RabbitMQ's rule of enabling all feature flags before the next version.
- **Migrations:** keep `AutoBuildMessageStorageOnStartup = AutoCreate.None`. The one-shot `migrate` path applies the existing EF bundle, then explicit `IHost.SetupResources()` for both application configurations. W0 proved this setup path and missing-storage startup rejection in 6.50.0. Envelope mappings are excluded from EF migrations; they do not provision the full Wolverine schema. Keep the default storage-error policy and durability agents enabled. Missing-table checks are not a complete schema-drift check, so upgrades also require storage validation.
- **Envelope isolation:** use `wolverine_api` and `wolverine_worker` schemas in the same database, with distinct service names. A service name alone does not isolate recovery. Replicas of the same application share its schema. Do not confuse Wolverine's envelope node-owner number with Vessel's journal owner ID.
- **Runtime packaging:** the tested option is `WolverineFx.RuntimeCompilation` with dynamic handlers in the runtime-only .NET 10 image, non-root and with a read-only application directory. No SDK is required in that tested image. Pregenerated handlers remain an optional, untested alternative. Pin the tested package family and reconcile EF Design/tooling versions during authorized integration; do not silently upgrade Vessel's EF runtime.
- **Credentials overlay:** mounts the key ring read-only into the worker as well, since it opens Lighter read tokens. The API still seals them. The worker never logs or forwards a token.
- **Heartbeat:** the worker writes a heartbeat row (instance, version, started, last beat), which the API reports so the UI can say "Monitor offline". It also writes a heartbeat file that its Docker healthcheck reads.
- **Upgrades:** `docker compose up -d` runs migrate, then recreates api and worker. A worker stopped during a run loses nothing: runs are idempotent, so the next run repeats the work.

### Owner scope in the worker

- **Messages:** every message carries `ownerId`. The worker validates it against the configured journal owner, then opens an immutable owner scope before resolving the database context. It loads the account through the normal owner-filtered queries. A mismatch is rejected, logging IDs only. The browser never chooses the command's owner.
- **Scheduler:** use the configured journal owner ID, matching the existing single-owner authentication setting. Do not enumerate unscoped accounts or introduce a multi-owner directory for this step.
- **Query filters** are never disabled.

## Scheduling and the unit of work

- **Unit:** one account. All its Planned, Paused and Open venue Plays share one run.
- **Eligible accounts:** enabled; venue with the `Sync` and `Orders` capabilities; a source identity; and at least one Planned, Paused or Open venue Play, or a Closed or Cancelled Play with linked exits that may still be resting. Keep checking those exits at the normal interval until fresh evidence confirms they are no longer resting, even if the owner dismisses their warning. This lets `protection.orphaned` be detected and cleared after the last active Play closes. A required credential that is missing or unusable suspends venue reads and leaves a visible `credential-error`, rather than making the account disappear from monitoring.
- **`monitor_accounts`:** one row per account holding:
  - state, interval and `next_run_at`;
  - lease holder and `lease_until`;
  - last attempt, last success and consecutive failures;
  - a safe error text;
  - the newest fill time seen (for gap detection).
- **Scheduler:** every 30 s, the worker claims due rows with `FOR UPDATE SKIP LOCKED` and sets a renewable 5-minute lease with a generation number. It then runs `RunAccountMonitor` on an in-process queue, at most 2 accounts at a time. Each commit checks the current lease generation; a worker that lost its lease cannot apply late results. Lease expiry recovers a crashed run. The existing account locks still serialize writes against the API.
- **Cadence:** `Vessel:Monitor:Interval`, default 10 minutes, allowed from 1 to 60 minutes, with ±10% jitter.
- **Failures:** retry after 1 and then 3 minutes, then return to the normal interval. Failures count towards `stale`.
- **Check on demand:** the Check button records a request ID and sends `RunAccountMonitor` through the API outbox in the same transaction; opening a Play does not. Per account, scheduled, confirmation and manual runs share one admission gate:
  - while one is pending or running, further requests are refused;
  - after it finishes, including a failed attempt, requests are refused until the cooldown ends (`Vessel:Monitor:ManualCooldown`, default 60 s);
  - a refusal returns 429 with `Retry-After`;
  - `monitor_accounts` records the request ID, pending/running state and `next_manual_allowed_at`, so the rule holds across tabs and API restarts.

  A scheduled run that starts before an accepted manual command covers that request. Duplicate or delayed commands carrying the same request ID cannot start another run. Completion resets the next scheduled run, so Check does not cause an immediate duplicate poll. Broker recovery republishes a still-pending request, not a new request ID.
- **Confirmation run:** when a run finds a new discrepancy candidate, it schedules one account-wide follow-up, no earlier than 60 s later or the protection grace deadline, whichever is later. Only a fresh, sufficiently complete read can confirm or clear it. A failed or incomplete confirmation leaves the candidate unknown and the monitor degraded. Confirmation work shares the lease and venue request budget.
- **Venue reads:** the run reuses the existing sync adapters and order reader, once per account rather than once per Play. Average interval cost does not control bursts from scheduled runs, Check, account Refresh all, retries and the chart. Bound concurrency and retries by venue capabilities and limits; honor rate-limit responses. Incremental fill cursors stay a later optimization. Exact request budgets are adapter implementation details, not a guarantee of headroom in this plan.
- **Lock scope:** venue reads move out of the database transaction. Before reading, capture the account's source/settings and credential revision. Under the account lock, reload and revalidate owner, enabled state, source and revisions, along with the run's lease generation, before applying results. Use the existing "newer observation wins" guard as well. A changed or disabled account discards stale results. Manual account refresh must use the same read/admission path; otherwise it can bypass the monitor's throttling and restore the network-held lock.
- **Credentials:** a refused or expired token sets `credential-error` and stops retries until the credential changes; saving a token reschedules the account. A token expiring within 14 days raises `credential.expiring` once.
- **History gaps:** sometimes a response hits the venue's cap (2,000 fills on Hyperliquid) and its oldest fill is newer than the newest fill seen before. The account is then `degraded` ("fills may be missing"). Vessel never concludes that no fill happened.

## Detecting fills and changes

- **Polling only.** At this cadence REST is the only path. Venue user streams (Hyperliquid `userFills`, `orderUpdates`) are not needed. They remain a possible later capability that triggers a reconcile, never a replacement for it.
- **Deduplication** uses the existing unique indexes on fills (owner, account, contract, source fill ID) and orders (owner, account, order ID).
- **Events come from Vessel's own state changes** inside the transaction: a link created, a status moved, a discrepancy opened or resolved. They never come from "rows seen". Re-reads, restarts and overlapping runs therefore emit nothing new, and the first worker run after deployment re-emits nothing already linked or transitioned.
- **Watch start and matching are separate.** The existing matcher uses `CreatedAtUtc`, not `PlannedAtUtc`, as its earliest order time. This step must not silently change that matching rule. Persist an event baseline for already-linked fills when monitoring is enabled. Pre-watch imports and baseline rows do not become fresh fill alerts; newly discovered relevant changes after the watch boundary can be late events. Relinking a known fill emits a link change, not another claim that the venue just executed it.
- **The trigger doesn't matter.** The same transition, link and discrepancy code runs for the worker and for owner actions in the API, and both append events through `IPlayEventSink`.

## Positions, stops and targets

- **Open quantity of a Play:** linked entry fills minus linked exit fills.
- **Expected position** for an account and instrument: the signed sum of its Open Plays' open quantities. Opposite Plays net out in one-way accounts. Venues that report separate long and short legs are compared per leg.
- **Venue position:** the snapshot's `SignedQuantity` for that contract, read in the same run. Keep observation times and read completeness for positions, fills and orders separately. The current sync reads the snapshot before the separate order read, so reusing it unchanged cannot satisfy a promise that the snapshot is newer than every order. A later position read helps but is not an atomic venue snapshot. Comparisons use the instrument's quantity precision, require adequate coverage and must agree on a fresh confirmation run before opening a discrepancy.

A position cannot assign fills to a Play, because it carries no order IDs. Linking stays order-based. An exit that takes the only Open Play on an instrument to flat already links automatically as an unplanned exit. With several Open Plays, it becomes a suggestion that states the venue position. What the position adds is corroboration of closes and the instrument-level discrepancies below.

### Discrepancies

A discrepancy is a flagged record. It never changes a status or a link. It opens only after the confirmation run, resolves by itself when fresh evidence shows the condition cleared, or is dismissed by the owner with an optional note. Missing rows in a partial read do not prove a cancelled stop or a flat position. A dismissed discrepancy stays dismissed until the quantities or orders involved change.

**Per Play:**

| Kind | Condition | Severity |
|---|---|---|
| `protection.missing` | Open quantity, no resting linked stop, and the first entry fill older than the grace period (`Vessel:Monitor:ProtectionGrace`, default 10 min) | critical |
| `protection.cancelled` | A linked stop was cancelled without filling while the Play is Open | critical |
| `protection.short` | Resting linked stop quantity is below the open quantity. A whole-position stop counts only when the adapter establishes its coverage; do not count one account-level order independently for several Plays. Unknown coverage is shown as unknown. | warning |
| `protection.excess` | Resting linked stop or target quantity is above the open quantity | warning |
| `protection.orphaned` | A Closed or Cancelled Play still has a resting linked stop or target, which could close another Play's position on the same instrument | warning |
| `level.drift` | A linked order's price no longer matches its plan level, for example after an edit at the venue. Suggests a plan revision. | info |

Targets smaller than the position are not flagged, because scaling out is normal.

**Per account and instrument** (each record lists every Open Play involved and closes none):

| Kind | Condition | Severity |
|---|---|---|
| `position.missing` | The expected position is non-zero and the venue is flat | critical |
| `position.opposite` | The venue position has the opposite sign | critical |
| `position.short` | The venue position is smaller than expected, same sign | warning |
| `position.excess` | The venue position is larger than expected: untracked exposure | warning |
| `fill.unlinked` | A fill on the instrument after an Open Play's first entry, whose order is neither linked nor suggested | warning |

`play_discrepancies` holds:
- owner, account, Play (null for instrument-level kinds), contract and kind;
- a fingerprint of the quantities and orders involved;
- state, plus opened, confirmed, resolved and dismissed times;
- the note;
- details with exact decimal strings.

One open record exists per account, kind and subject.

## Event contract

```json
{
  "id": "0192f0c4-…", "type": "execution.filled", "version": 1,
  "ownerId": "…", "sequence": 1234, "runId": "…",
  "dedupKey": "order:{accountId}:{orderId}:filled:0.5",
  "severity": "warning", "occurredAt": "2026-10-14T03:12:08Z", "detectedAt": "2026-10-14T03:20:41Z",
  "timeliness": "timely", "relevance": "current", "expiresAt": null,
  "subject": { "accountId": "…", "venueId": "hyperliquid", "contractId": "BTC", "playId": "…", "entryId": "…", "levelId": "…" },
  "source": { "trigger": "monitor", "orderIds": ["…"], "fillIds": ["…"] },
  "data": { "role": "stop", "side": "sell", "filledQuantity": "0.5", "cumulativeQuantity": "0.5",
            "remainingQuantity": "0", "averagePrice": "83900", "complete": true }
}
```

| Field | Meaning |
|---|---|
| `id` | UUIDv7, stable; consumers dedupe on it |
| `type`, `version` | The event kind and its payload version |
| `sequence` | Owner-scoped, commit-ordered cursor for catch-up; independent of broker arrival order |
| `runId` | Groups the events of one monitor run or owner action, so a consumer can send one message for them |
| `dedupKey` | Unique; a repeated insert is ignored |
| `occurredAt` / `detectedAt` | The source time when known, and when Vessel recorded the change. Owner actions use their action time; discrepancies use first qualifying observation time, not an invented venue cancellation time. |
| `timeliness` | `timely`, or `late` when `detectedAt − occurredAt` exceeds twice the interval: an outage or backlog, not the normal cadence delay |
| `relevance` | `current`, or `superseded` when a later change found in the same run overtakes it. Example: an entry fill and a stop fill both happened between two runs, so `play.closed` tells the whole story. |
| `expiresAt` | Set for time-sensitive types. A consumer that receives the event later records `expired` instead of sending it. |
| `severity` | `info`, `warning` or `critical` |
| `subject` | Account, venue, contract, and when relevant the Play, entry, level and discrepancy |
| `source` | `monitor` or `owner`, with the order and fill IDs that caused it |
| `data` | Type-specific, exact decimal strings |

### Late events

New watched state changes become events; re-read rows and pre-watch history do not. Imported facts remain in their own tables even when they cause no event. Every event says whether it is timely or late, and whether it was still current when detected. Consumers recheck current relevance at delivery, because a queued missing-stop warning may already be resolved. For example, Telegram can:
- send current events individually;
- fold superseded and late ones from the same run into one message ("While the monitor was offline: entry filled 03:12 at 84,541, stop filled 05:40 at 83,900; Play closed");
- drop expired ones.

Discrepancies are evaluated on the current state, so a problem that resolved itself during an outage never raises one.

### Catalogue, version 1

| Type | When | Severity | Dedup key |
|---|---|---|---|
| `play.opened` | Planned or Paused → Open | info; warning when filled while paused | `play:{playId}:opened` |
| `play.closed` | Open → Closed; data carries entered, exited, closed PnL, PnL basis and fees by token | info | `play:{playId}:closed` |
| `play.status-changed` | Other saved status changes, including planning, pause, resume and cancellation; data carries previous/current status and source | info | `status-change:{statusChangeId}` |
| `execution.filled` | New linked fill quantity on an entry, stop, target or exit order; `complete` says whether the order is fully filled | info; warning for stops | `order:{accountId}:{orderId}:filled:{cumulativeQuantity}` |
| `link.needs-confirmation` | An ambiguous order became a suggestion | warning | `link:{linkId}:suggested` |
| `execution.link-changed` | An owner or the matcher links, confirms, unlinks or dismisses a link; data carries previous/current state | info | Stable link-change identity allocated with the mutation |
| `discrepancy.opened` | A confirmed discrepancy; data carries its kind and details | per kind | `discrepancy:{id}:opened` |
| `discrepancy.resolved` | Cleared or dismissed | info | `discrepancy:{id}:resolved` |
| `monitor.state-changed` | An account moves between monitor states | warning when leaving `live`, info when returning | `monitor:{accountId}:{state}:{since}` |
| `credential.expiring` | A read-only token expires within 14 days | warning | `credential:{accountId}:{expiresAt}:expiring` |

Versioning:
- Adding optional fields keeps the version.
- Removing or renaming a field, or changing its meaning, creates the next version. Producers write it only once every consumer accepts it.
- Each type has a golden JSON contract test.

Fill accounting cannot rely on the 90-day event history. Keep a durable source-identity baseline for each owner's account, contract and fill, and canonicalize cumulative quantities used in dedup keys. A repeated observation, retry, relink or event-retention sweep must not recreate an execution notification. Event ordering and fill baselines need concurrency and retention tests before Step 2 is complete.

## Consumers and delivery

- **Routing:** RabbitMQ topic exchange `vessel.events`, routed by `type`. Each consumer has its own durable queue.
- **Each consumer has:**
  - per-owner settings: enabled, minimum severity and event types;
  - its own retry policy and backoff;
  - its own rate limit (Telegram's per-chat limit later);
  - its rows in `event_deliveries`.
- **In-app (this plan):** the API uses broker events as wake-up hints and streams committed `play_events` rows in cursor order. Live push uses a per-instance queue; reconnect and a periodic database catch-up recover missed hints. A live browser connection is not a durable notification consumer and does not need delivery receipts. Popups, their acknowledgement and channel-specific delivery settings belong to the later notification plan.
- **Commands:** `RunAccountMonitor` goes from the API to the worker over the `vessel.monitor` queue.

## Health and visibility

| State | Meaning |
|---|---|
| `live` | The last run succeeded within twice the interval |
| `stale` | No successful run for longer than twice the interval |
| `degraded` | A partial read or a history gap |
| `credential-error` | The token is missing, refused or expired |
| `idle` | Nothing to watch |
| `offline` | The worker heartbeat is missing (system-wide) |

`offline` is derived by the API when the worker cannot report its own failure. Staleness also advances from stored timestamps without waiting for a healthy worker to publish an event.

The UI shows this inside existing areas; the approved layout does not change:
- **Execution tab:** "Monitored · checked 4 min ago · next in about 6 min" with Check. The button shows "Checking…" while the run is pending or running, then a cooldown countdown before it can be used again. Stale: "Monitor stale since 14:02: fills may be missing". Credential error: a link to manage the token. Discrepancies are listed with Dismiss.
- **Account rows and detail:** a badge only when the state is not `live` or `idle`. Instrument-level discrepancies also appear on the account detail.
- **Shell:** a banner when the worker is offline while Plays are tracked.

## API and frontend

| Route | Purpose |
|---|---|
| `GET /api/events?after={sequence}&limit=` | The owner's events, bounded, oldest first |
| `GET /api/events/stream?after={sequence}` | SSE: `event`, `status`, keepalive. Read with `fetch` and the bearer header through `api/sse.ts`; at most 4 streams per owner |
| `POST /api/accounts/{id}/monitor/run` | 202 with the request time; 429 with `Retry-After` while a manual run is pending, running or cooling down; 409 when the account cannot be monitored |
| `GET /api/accounts/{id}/monitor` | State, last success, next run, safe error, manual run state and when Check is available again |
| `GET /api/plays/{id}/execution` | Adds `monitor` and `discrepancies` |
| `POST /api/plays/{id}/discrepancies/{discrepancyId}/dismiss` | With an optional note |

- **Check endpoint:** `POST /api/plays/{id}/execution/check` is retired in favour of `monitor/run`.
- **Browser:** the 60 s venue polling in `usePlayExecution` goes away. The shell keeps one event stream. On an event for the open Play's account, the browser re-reads the stored execution, which touches the database only. If the stream is down, it polls that read every 60 s.
- **Manual refresh** of an account stays available on the Accounts page. Its server path shares admission, source-revision validation and import locking with monitor runs. Decide its synchronous/asynchronous response shape during the worker step without allowing it to bypass read throttling.

## Delivery steps

### W0: Wolverine spike, complete

**Verdict: conditional go for Wolverine 6.50.0.** Not a drop-in substitution for inner `SaveChangesAsync` calls. The [research report](wolverine-fit-research.md) records primary sources, exact versions, the evidence matrix and reproduction instructions. Disposable code and recorded outputs live in `spikes/wolverine/`.

Proved in the isolated spike:
- real sealed `VesselDbContext`, real nested store locks and atomic rollback/commit when persistence, outer commit and flush stay separate;
- recovery after commit/process exit and after broker outage followed by broker/producer restart;
- business EventId dedupe with a PostgreSQL effect, plus separate same-envelope inbox dedupe;
- explicit schema setup, missing-storage rejection with automatic schema creation disabled, and separate API/worker recovery schemas;
- durable RabbitMQ topic/quorum topology and publisher confirms, including the unsafe unbound-topic case;
- scoped owner validation and isolation under concurrent message handling;
- dynamic handler execution and explicit setup in the runtime-only .NET 10 container.

Not proved by W0: continuous reconnect without producer restart, full schema-drift rejection, broker-volume-loss/database-restore recovery, the eventual product event mapping/retention/scheduler, bidirectional product commands/events, pregenerated code, local-only transport tests, or external notification delivery. These are not implied by a successful spike. Carry the applicable cases into integration/release tests.

The earlier Claude attempt failed at a provider limit. The replacement Sol investigation completed, and the parent took over evidence review after the owner requested stopping the agent. No product files, migrations, deployment or owner database were changed. The recommendation does not authorize product implementation.

### Step 1: Bounded unit-of-work refactor

- Application-owned `IUnitOfWork` and one scoped implementation coordinating the existing DbContext.
- Move transaction completion and saves out of the relevant stores into the unit of work, preserving necessary intermediate saves.
- Start with Play/execution writes and their shared account-import path. Adapt callers that share those store methods, including management flows, without broadening into unrelated read-only reports or a repository rewrite.
- Preserve existing commit boundaries, ownership checks, account/management/advisory lock ordering, settings revisions and conflict responses.
- Prove rollback after intermediate saves, one outer commit, nested-service participation, replacement-row correctness and reconciliation read-after-save behavior.
- No event tables, Wolverine packages, broker, worker, scheduler or frontend behavior changes in this step. No schema migration should be needed.
- Gate: existing behavior and transaction regression tests pass before adding messaging.

### Step 2: Event log and outbox

- `play_events`, `event_deliveries` and `IPlayEventSink`.
- Commit-ordered owner cursors, pre-watch fill baselines and retention-safe event identity.
- Events from the existing transitions and links in `PlayExecutionService`.
- Integrate Wolverine persistence and post-commit dispatch at the tested unit-of-work boundary, with regression tests for premature commit and pre-commit dispatch.
- RabbitMQ in Compose and the relay.
- The `play.opened`, `play.closed`, `execution.filled` and `link.needs-confirmation` contracts.
- Migration and contract tests.

### Step 3: Worker and scheduler

- `Vessel.Worker`, `monitor_accounts`, the scheduler and `RunAccountMonitor` with owner scope.
- Venue reads outside the lock.
- Health states, `monitor.state-changed` and `credential.expiring`.
- The heartbeat.
- `monitor/run`, and retiring `execution/check` and the browser's venue polling.
- Compose worker service, image entrypoint, credentials overlay, release verification and README.

### Step 4: Discrepancies

- Normalized read-coverage fields for positions, open orders and fill history, supplied by each adapter; unknown coverage stays unknown.
- The rules above and the confirmation run.
- `play_discrepancies` and the discrepancy events.
- Execution tab list with Dismiss; account detail.

### Step 5: In-app live updates

- The events read and stream routes.
- The shell subscription and the database-only fallback.
- Monitor status texts and the offline banner.

### Later (separate plans)

- Notification consumers: Telegram, Discord, in-app popups with acknowledgement and per-owner settings.
- Price and drawing alerts.
- Venue user streams as a capability.
- Incremental fill cursors.
- A normalized liquidation fact (RISEx `is_liquidation`, Hyperliquid liquidation events) for a `position.liquidated` event.

## Price and drawing alerts (deferred)

The owner wants alerts when price reaches a Play's drawings (lines, levels, ranges). They need prices close to real time, so they take a different path from the periodic monitor:

- **Price watcher:** an in-memory component in the worker that uses the venues' market streams. The shared stream relay would move so the worker can use it. RISEx would build prices from its public `trades`/`oracle` channels, and Lighter from `market_stats`. A venue without a stream would fall back to short REST polling of the mark price.
- **Definitions:** alerts are armed from a Play's drawings and plan levels and evaluated on the mark price with hysteresis.
- **Events:** only the crossing becomes an event (`price.crossed`, `level.approached`), with a short `expiresAt` and an explicit observation flag. Ticks never enter the outbox. A crossing is never a fill and never changes a status.
- **Restarts:** after a restart, alerts re-arm. Whether a crossing missed while offline is reported once as late is to be decided with that plan.

## Tests

- **Application:**
  - one event per transition, with stable dedup keys;
  - timeliness and relevance;
  - every discrepancy kind, including the confirmation run, several Plays sharing an instrument, opposite Plays netting out and lot rounding;
  - owner scope in handlers.
- **PostgreSQL** (disposable database, as today):
  - the unit of work commits once, rolls back intermediate saves and cannot be completed by nested stores;
  - replacement rows, reconciliation reads, management locking and concurrency conflicts retain existing behavior;
  - the event and the Play change commit or roll back together;
  - a repeated dedup key is ignored, including after event history has been pruned;
  - a delayed commit cannot be skipped by catch-up; an expired or restored cursor requests a reset;
  - two schedulers do not own a current lease together; a stale lease holder cannot commit;
  - scheduled, manual and confirmation requests coalesce, including redelivered commands;
  - account disable/source/credential changes during network reads reject stale results;
  - migrations have no pending model changes, and Wolverine storage is applied only by `migrate`.
- **Worker:** fake venue adapters take a Play from Planned to Open to Closed with no browser. Also covered: a refused credential, a history gap, incomplete reads that neither confirm nor clear a discrepancy, closed-Play orphan exits, grace deadlines, and late or superseded events after simulated downtime.
- **Broker** (opt-in, disposable RabbitMQ container): an owner link in the API reaches a worker consumer; a broker restart; duplicate delivery is ignored; the republish sweep recovers a lost queue.
- **Frontend:** event handling, fallback polling, monitor status texts and Dismiss.
- **Release:** `scripts/verify-release.py` covers the worker entrypoint and healthcheck, RabbitMQ not being published, and backup and restore without the broker volume.

## Authorization and delivery tracking

On October 14, the owner authorized implementation by Sol agents, a separate Sol verification, a final isolated end-to-end verification and stacked pull requests. The five delivery steps above define the stack, each based on the preceding layer. The parent integrates changes, verifies the final application and opens the PRs. Notifications and drawing alerts remain excluded.

Track the verified state, test evidence and PR links in `play-monitor-state.md`. W0 integration constraints remain mandatory; authorization is not evidence that an untested gate has passed.

## Risks

- **Wolverine is a large framework.** It brings runtime code generation, its own conventions and its own tables. Mitigation: the W0 spike, keeping it behind Application ports, and explicit storage setup.
- **Two stateful services.** Treating RabbitMQ as replaceable transport depends on tested recovery from retained PostgreSQL events and pending commands. External delivery duplicates remain possible.
- **Reported late by design.** A filled stop is reported up to one interval later; the owner accepted this.
- **Venue history limits.** Very active accounts can lose fills after a long outage (Hyperliquid's latest 2,000). This is shown as `degraded`, never as "no fill".
- **Snapshot and fills read moments apart.** Coverage checks and confirmation reduce false positives; they do not turn independent venue responses into an atomic snapshot.

## Primary references

1. [Wolverine durable messaging](https://wolverinefx.net/guide/durability/): the outbox's guarantee, duplicate rejection by message ID in the inbox, and no two-phase commit with brokers.
2. [Wolverine message storage management](https://wolverinefx.net/guide/durability/managing): `AutoCreate.None`, `resources setup`, `db-apply` and `db-dump`.
3. [Wolverine EF Core outbox](https://wolverinefx.net/guide/durability/efcore/outbox-and-inbox.html) and [EF Core migrations](https://wolverinefx.net/guide/durability/efcore/migrations).
4. [Wolverine RabbitMQ transport](https://wolverinefx.net/guide/messaging/transports/rabbitmq/): `WolverineFX.RabbitMQ`, provisioning and publisher confirms.
5. [Hyperliquid rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) and [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).
