# Vessel today

Vessel is a self-hosted trading diary for one owner. It connects decisions,
execution facts and later reflection. It does not place orders or offer trading
advice. A chart reaching a price never proves that an order filled.

## Which version this describes

This describes `main` on October 17, 2026, after the Notification Hub merged
(PRs #62–#65, `43ebaa0`) and the follow-up that locks an account while a Play is
created on it. It covers the background monitor, venue funding, order identity,
paged lists and in-app notifications. It is a description of the code, not a
claim that any version is deployed; work in other branches is not included.
Older discovery documents contain plans and historical limits; they are not a
feature inventory.

Start with the [four diagrams](diagrams/app-status.md). For backend internals,
continue to the [backend guide](architecture/backend-guide.md). The
[glossary](../CONTEXT.md) defines Play, plan, execution and review.

## Find your way around

Connect with the installation's Vessel API token. This is a private session,
not a venue login. The token stays in memory and disconnect ends that session.

| Screen | What works here |
| --- | --- |
| Overview | Scope balances, availability, an allocation of portfolio and account shares, recent imported operations and saved Plays to all accounts, a portfolio, Unassigned or one account. Group the Summary by portfolio or account and choose a realized-result period. |
| Plays | Save ideas and plans, edit entries and exits, inspect executions and monitor findings, keep chart evidence, and write or amend a review. Tabs (Drafts, In progress, Needs review, Reviewed, Closed, Cancelled, All) carry server counts, with title and instrument search. |
| Review | Inspect eligible saved closed-Play results by rolling period, portfolio, account or asset. Open contributing Plays and drill into exclusion reasons. |
| Portfolios | Create optional groups with a name and built-in icon. Add, move or unlink accounts, including bulk membership changes. |
| Accounts | Add manual or supported venue accounts, inspect balances and positions, refresh imports, ask for a monitor Check, manage credentials where needed, or disable an account. Group the list by venue or address. |
| Activity | Inspect retained imported executions grouped into position operations, and settled funding payments. Filters and numbered pages run on the server; executions load when a row expands. Preview an eligible operation for retrospective creation. |
| Notifications | Read in-app notifications about fills, order links, discrepancies, monitor health and credentials: Unread and All with counts, category and severity filters, links to the Play or account, Mark as read and Mark all as read. A red count on the sidebar entry (a bell on narrow screens) shows what is unread. |
| Settings | Choose dark or light themes, customize colours and radius, or generate and save a named palette in this browser. Set notification preferences and send a test notification. Inspect connection and capability information. |

One ordinary journey is Accounts, Refresh, Activity, then Plays or Review.
Another starts with a new Play and records its reasoning before execution.
Portfolios are optional. Unassigned means no portfolio, not a default portfolio.

Disabling an account retains its imports but hides its financial activity and
blocks refresh. Deleting a portfolio unlinks its accounts. Account deletion
requires confirmation and is blocked by linked Plays.

See the [screen workflow](diagrams/app-status.md#screens-and-owner-workflow),
[shell implementation](../frontend/src/features/workspace/ApplicationShell.tsx)
and [account-management contract](architecture/account-management-contract.md).

## What a Play contains

The desktop workspace keeps capital context above the work area, with a chart
on the left, the journal beneath it, a bounded position editor on the right,
and a position Summary below. Entry details can expand without losing edits.
Themes change colours and radius, not this layout.

- A plan has direction, whole-number leverage, sizing, entry quantity shares,
  multiple stops and targets, thesis, invalidation and free-text strategy notes.
- The chart has candles, drawings, plan/range tools, configurable EMAs, Volume
  and RSI. Manual instruments keep a placeholder instead of invented prices.
- Captures and uploaded images keep notes and editable markup beside the
  untouched original image.
- Suggestions offer size, stop, target and leverage estimates with reasoning
  and individual Accept actions. Nothing is applied automatically.
- The bottom Summary estimates the whole planned position and shows allocation
  and price/exit coverage. Partial coverage is not silently scaled to 100%.

Planned money estimates exclude fees, funding and slippage. An estimated loss at
a stop is not a guaranteed maximum loss.

Status, execution progress and review are separate. A saved Draft becomes
Planned when the owner commits to it; its account and instrument become fixed.
Later plan changes require a reason and append a revision. Linked venue fills,
found by the background monitor, or recorded manual executions move it through
Open to Closed. The Execution tab shows the account's monitor state and any
discrepancy it found, such as an open position without its stop; discrepancies
are flagged for the owner, never corrected, and can be dismissed with a note.
Closed and Cancelled are final; review and evidence can still change.

Structured review records adherence, a mistake tag, a lesson and a next action
alongside free text. Review amendments keep history. The Strategy tab is a note,
not an implemented strategy library.

The [lifecycle diagram](diagrams/app-status.md#play-lifecycle) and
[diary contract](architecture/diary-completion-contract.md) explain the terminal
rules. [PlayWorkspace](../frontend/src/features/plays/PlayWorkspace.tsx) assembles
the current layout; [chart-plan](architecture/chart-plan.md) records its tools.

## Keep three kinds of evidence separate

| Kind | Where it comes from | What it means |
| --- | --- | --- |
| Imported execution | A read-only venue response retained with source identity | The venue reported a fill. It does not supply a thesis or prove which Play the owner intended. |
| Manual execution | An explicit owner entry or exit on a saved manual-account Play | The owner recorded an execution, with time, side, quantity, price, source and known or unknown fees. It is not venue-confirmed. |
| Market observation | Candles, market context or the live chart stream | A price was observed. It does not create fills, order links or execution-driven status changes. |

Monitor checks link imported orders to Play levels automatically only when the
match is unambiguous. Ambiguity becomes a suggestion for the owner. Fills reach
a Play through those order links, never merely because the account and asset
match. A venue order keeps its own external identity per contract, and links
point to Vessel's internal order record. Several active Plays can share an
account and instrument.

Manual executions use a chronological average-cost ledger for linear USD-quoted
positions. Corrections require a reason and retain before/after values.
They can drive Planned to Open to Closed, but cannot reopen a Closed Play.
They do not enter the imported Activity feed or alter reported account balances.

Activity operations are calculated round trips, not inferred Plays. The owner
can preview and confirm a complete, closed, unassigned operation as a
retrospective Play. Creation rechecks the facts under a lock and links whole
orders atomically. Split/flip allocations, overlapping associations and missing
order executions can make an operation ineligible.

A retrospective Play starts Closed. It has no invented pre-trade thesis,
leverage or initial-risk R. Eligible net results can enter Review, but these
Plays are excluded from the sizing ladder. Eligible closed manual Plays can
contribute to Review and sizing, with manual provenance and cost checks.

[Data-flow diagram](diagrams/app-status.md#facts-intent-and-reports) ·
[DiaryService](../backend/src/Vessel.Application/Plays/DiaryService.cs) ·
[Activity rules](architecture/activity-operations.md) ·
[Review rules](architecture/portfolio-review.md) ·
[SizingService](../backend/src/Vessel.Application/Sizing/SizingService.cs).

## Venue support is deliberately uneven

All integrated instruments are perpetuals. Browser controls follow the API's
venue capabilities rather than assuming every venue provides the same data.

| Venue | Account identity and access | Account/execution reads | Chart |
| --- | --- | --- | --- |
| Hyperliquid | Public EVM address; no venue credential | Primary-perpetual snapshot, bounded recent fills/orders, supported stablecoin wallet balances | Candles, market context and live updates |
| RISEx | Public EVM address; no venue credential | Snapshot and bounded recent fills/orders; all supported market categories retain their category tag | Candles and market context; manual refresh, no stream |
| Lighter | A separate Vessel account for each selected account index; wallet discovery lists main/subaccounts | Public account/fill reads; orders require a verified read-only `ro:` token | Candles with manual refresh; no market context or stream |
| Manual | Owner-entered account and instrument | Optional account value and explicit Play executions; no venue imports | Placeholder; uploaded evidence remains usable |

Lighter history excludes fee-bearing or unverified-fee fills and fills without
reported PnL, with a coverage notice. A missing order token does not erase
successful public balance/fill reads, but order completeness and linking remain
limited.

Refresh also retains settled funding payments over a bounded 30-day window,
as signed amounts with their native identities. Activity shows them beside the
operations, attributed where the timing is unambiguous and unassigned
otherwise. Funding never changes execution P&L, Review or sizing.

Canonical instrument keys preserve multipliers, such as `1000PEPE`, while native
venue contract IDs remain available for matching and trade links.
This is not spot trading, EVM wallet valuation or guaranteed full-history import.

See [venue registration](../backend/src/Vessel.Infrastructure/DependencyInjection.cs),
[Lighter delivery](architecture/lighter-delivery-contract.md),
[RISEx scope](architecture/risex-integration.md) and
[stablecoin scope](architecture/stablecoin-wallet.md).

## What is saved, and where

| Location | Contents and lifetime |
| --- | --- |
| PostgreSQL | Accounts, portfolios, latest snapshots, retained fills/orders and funding payments, saved Plays, plan/status/review history, order links, manual executions/corrections, diary retry records and sizing settings. Also the monitor's state and discrepancies, the event log with its outbox and subscription receipts, notifications with their read state and preferences, evidence notes/markup and encrypted venue credentials. It is the record for all of them. |
| Evidence object store | Original image bytes for saved Plays, behind the evidence API. A local directory by default; an S3-compatible service (RustFS in the Compose example) only when configured. |
| RabbitMQ | Transport only: the `vessel.events` topic, one queue per subscription and module command queues. Losing it loses no record; subscribers catch up from PostgreSQL. |
| Server configuration | Installation token and credential-encryption key ring. The key ring is outside the database and never sent to Vite or the browser. |
| Browser memory | Connection token, unsaved edits/drawings/images, shell filters and scope, the event and notification stream cursors, and the session candle cache. Navigation retains the draft; reload or disconnect discards unsaved work. |
| Browser `localStorage` | Appearance and chart-view preferences only, including saved palettes and indicator settings. No token, execution history, candle history or Play draft. |
| Server memory | Bounded public catalogue, candle and market-context caches, plus active market-stream subscriptions. These are not a durable candle archive. |

Save writes the Play and then synchronizes its images. These are separate
requests, so a saved Play can still have an image upload pending after failure.
Check the save result before treating evidence as durable. Retrying keeps
successful image work instead of claiming the whole save was atomic.

The [runtime diagram](diagrams/app-status.md#runtime-and-trust-boundaries),
[database context](../backend/src/Vessel.Persistence/VesselDbContext.cs) and
[browser save path](../frontend/src/features/plays/saved.ts) show these boundaries.

## What starts work

| Trigger | Current behaviour |
| --- | --- |
| Add/import account | Creates account records; discovery is read-only. The browser then queues one bounded initial refresh when the venue supports it. A failed refresh keeps the account. |
| Refresh account / Refresh all | Reads bounded venue state, fills and funding, then retains available orders. Refresh all runs sequentially with progress and one result summary. This path does not link orders or change a Play's status. |
| Monitor worker | Every 10 minutes by default (`Vessel:Monitor:Interval`), checks each enabled venue account with a Planned, Paused or Open Play, or with linked orders of an ended Play that may still rest: reads venue orders, fills and positions, links orders, derives status and flags discrepancies after a grace period. Every change is recorded as an event. |
| Check | Asks the worker to run an account's check now. The answer is "accepted", not "done". It is refused while a run is pending or running, for 60 seconds after one completes, and when the worker is offline. |
| Event stream | The browser keeps one authenticated stream. On an event it re-reads stored state; if the stream is down it polls the stored reads every 60 seconds. Opening a Play never reads venue orders or fills. |
| Notifications worker | Turns events into in-app notifications under the owner's preferences: grouped per check run, withdrawn when superseded, shown as timed popups once across tabs and kept on the Notifications page. |
| Open/switch/refresh chart | Loads or revalidates bounded candle windows. Manual Refresh bypasses reusable cached data. |
| Live chart enabled | Hyperliquid data flows through one shared backend WebSocket and authenticated server-sent events. Reconnects can fall back to 15-second market-data polling. Hidden tabs pause the stream. |
| Save, record/correct execution, confirm retrospective, review | Explicit owner writes. Version checks or preview fingerprints reject stale changes rather than silently overwriting them. |
| Open Overview, Activity or Review | Reads retained facts and derives reports. Reporting does not sync a venue, assign executions or change a Play's status. |

Monitor checks are periodic, not real time, and keep running with the browser
closed. Market observations from the live chart never create fills or status
changes. See the [monitor plan](architecture/play-monitor-plan.md),
[messaging and workers](architecture/messaging-and-workers.md), the
[Notification Hub plan](architecture/notification-hub-plan.md),
[live market handling](../frontend/src/features/market/useLiveMarket.ts) and
[cache rules](architecture/performance-plan.md).

## Read the numbers with their limits

Owner identity comes from API authentication, not request-body claims. Database
queries and writes enforce that owner; normal financial reports exclude disabled
accounts. The browser talks to Vessel, not directly to venue APIs.

Financial API values are exact decimal strings; unknown values remain null.
Derived estimates can have documented rounding. Coverage notices explain missing
facts and currency limits. A missing fee is not a zero fee, and reported net PnL
is not reduced by its fee a second time.

Balances describe account observations. Activity describes retained imported
operations. Review describes eligible saved closed Plays, using actual exits
and return on executed entry notional, not return on margin or account equity.
Do not add wallet and perpetual ledgers blindly, infer missing initial risk,
or assume RISEx reported PnL excludes funding.

## What is still absent here

| Not implemented in this checkout | What exists instead |
| --- | --- |
| External notification channels, browser system notifications, price and drawing alerts | In-app notifications only: popups, the Notifications page and the unread count. |
| Real-time execution tracking | Periodic monitor checks (10 minutes by default) and an on-demand Check with a cooldown. |
| Strategy library, reusable strategy definitions and versions | Free-text strategy notes plus disposable discovery prototypes. |
| Durable candle archive, backtesting and complete historical backfill | Bounded imports, a 30-day funding window and memory caches. TimescaleDB is a direction, not a running component. |
| Multi-user onboarding or order execution | One configured owner and read-only venue access. No venue signing or trading. |

The [backend review](architecture/backend-review.md) and
[strategy plan](architecture/strategies-plan.md) describe further work, not
additional running features. [Release packaging](../deploy/README.md) documents
images, HTTPS and explicit migrations; it is not evidence of a deployed version.
