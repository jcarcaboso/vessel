# MVP architecture alignment

September 30, 2026. This records the owner's confirmed scope and the implementation details still to settle. The owner subsequently authorized delegated foundation scaffolding, confirmed perpetuals-first for every venue and allowed multiple active plays on the same account/instrument. The bounded first step is defined in [the scaffold contract](scaffold-contract.md). The approved Graphite prototype remains unchanged.

The owner authorized the next core/main-shell step on October 1, 2026. Its delivered routes, read-only Hyperliquid scope, mounted migrations and remaining limits are in [core workspace state](core-workspace-state.md); the original foundation is not the current complete feature list.

## Owner confirmed direction

| Area | Direction |
| --- | --- |
| Frontend | React with Vite and TypeScript, feature-owned components and thin pages |
| UI base | The foundation uses editable shadcn-derived primitives customized to Graphite, not replacement of the approved layout with library defaults |
| Charts | Reusable, driven by Vessel workflows; usable by plays and later analysis |
| Backend | Modular business boundaries with clean dependency rules; the existing ASP.NET Core 10/PostgreSQL direction remains the working stack |
| Persistence | Provider specifics isolated where useful; good architecture takes priority over hypothetical database interchangeability |
| Audience and hosting | Self-hosted, single user initially, with a future direction toward user-owned portfolios and other records |
| Access | Token-based MVP access rather than full user registration |
| Integrations | Read-only Hyperliquid first, Lighter next; Quantfury is a candidate pending feasibility |
| Instruments | Perpetuals first for every integrated venue; spot is outside the first implementation |
| Concurrent plays | Multiple active plays may share the same account and instrument |
| Manual venues | Accounts and records remain usable without automated integrations |
| Imports | Optional initial history import, with a date selection or all available records |
| History | Imported executions can be reviewed retrospectively without a fabricated original thesis |
| Monitoring | Track entries and exits of monitored plays, including execution changes and relevant price levels |
| Notifications | In-page popups first; prepare a delivery boundary for later Telegram or Discord |

The scaffold selects a bounded initial set of frontend/backend projects, package versions, direct runtime bearer connection and PostgreSQL tooling. The owner requires pnpm for all JavaScript/TypeScript operations. These choices and completed checks are documented in [foundation state](foundation-state.md) and [development setup](../development.md). Scheduler, broker, final chart renderer, media backend and monitoring/import implementations remain outside this step. The old proposal is design context, not a current package manifest.

## Frontend and reusable charts

shadcn/ui supplies editable component code rather than forcing a closed set of imported controls.[1] I recommend using its control primitives for buttons, fields, dialogs, tabs, sliders and popups, adapted to Graphite. Our domain-specific price/percentage and entry-share controls should compose those primitives. Avoid wrapping every primitive merely to add another abstraction.

The chart renderer and data adapters should not know the entire Play aggregate. Share instrument identification, candles/time series, rendering and annotations, then let play and analysis features supply their own overlays and interactions. Chart selection must preserve the approved synchronized editing behavior.

Market data should identify venue, instrument/contract, quote/base units, timeframe, price source, timestamps and availability gaps. Instrument metadata and candle history are real capabilities, not an assumption that every venue returns identical assets or unlimited historical bars. A missing chart must not make imported execution history unusable.

Chart libraries, frontend state/form libraries and the shadcn component primitive choice still need a short fit evaluation before installation.

## Dependencies and persistence

I would put business-facing persistence and provider contracts in the consuming application/module contracts, with implementations in persistence or infrastructure. This refines the owner's suggested location of abstracts without creating interfaces for everything.

```text
Domain                      -> no infrastructure dependency
Application / module APIs   -> Domain
Persistence                 -> Application contracts and Domain
Infrastructure adapters     -> Application contracts and Domain
API / worker composition    -> Application plus concrete implementations
```

An infrastructure-abstractions library is acceptable if it contains only necessary contracts and does not reverse the dependency direction. Do not make the domain depend on concrete infrastructure just to obtain an interface.

The working boundaries remain Accounts/Portfolios, Journal/Plays, Strategies, Venue Imports and Evidence. Market Data and Notifications now need explicit ownership because they serve multiple workflows. That does not yet imply separate projects or services.

EF/Npgsql details belong in the persistence implementation. PostgreSQL-specific mappings and queries may be used deliberately; no generic repository or database-neutral framework is required merely for possible future portability.

## Token access and future ownership

The owner confirmed single-user token access, not a public unauthenticated backend. I propose one seeded journal owner and one generated/configured token mapped to that owner.

Owner identity should come from trusted authentication context, not a request body's arbitrary user ID. Scope account/portfolio/play/strategy/evidence/integration/notification roots by owner, and derive entry ownership through the play. Background work must carry the same ownership context. This prepares the direction of later multi-user isolation without implementing registration, roles, sharing or billing.

Before implementation, the security specification should settle token generation, verification, rotation/revocation, expiry policy, browser transport and private media access. Avoid putting a token in a Vite bundle, repository, URLs, application logs or browser local storage. OWASP warns against storing session identifiers in JavaScript-accessible local storage.[2]

For a direct bearer approach, memory-only browser handling is the simple starting proposal, not a defense against every XSS risk. A token exchange for a secure HttpOnly session cookie is an alternative if session persistence is required, with CSRF and cookie policies then part of the security specification. No JWT issuer, cookie flow or identity provider is selected here. Production access requires HTTPS and backend authorization; the unauthenticated LAN prototype is not the security baseline.

Application tokens are not venue trading credentials. The MVP should not request wallet signing or order-submission permissions solely to read an account.

## History import and retrospective review

The user should choose no initial import, all history the adapter can actually retrieve, or an explicit requested date range. From/Until fields are a proposed way to avoid the ambiguity of "until a date"; the exact UX remains open.

The job should report requested range, retrieved range/count, progress and whether provider limits or gaps prevent completeness. "All available" must not be presented as proof of a complete account lifetime. Hyperliquid's documented history and candle limits are recorded in [the capability research](hyperliquid-capabilities-research.md).

Keep four distinct records of knowledge:

- What the trader planned and knew before execution.
- What the venue reported, with source IDs, timestamps and correction provenance.
- Current account/position snapshots, which are not themselves a full execution history.
- A retrospective review entered later by the trader.

An imported fill/history record can exist without a Play, strategy version or thesis. A later review must be labeled retrospective rather than backdated into the original plan. Historical fills should not automatically generate current-play entry/TP/SL notifications.

A separate Trade History domain may become useful. The owner explicitly left that for later discussion; do not create another bounded context merely to settle the name now.

## Monitored plays and confidence

The owner wants monitoring associated with an open play. I propose an explicit tracking state on planned/active plays, persisted server-side. It should not depend on whether a browser tab remains open. The exact start/stop lifecycle and desired latency still need agreement.

Execution synchronization and price monitoring have different truth sources:

| Observation | Evidence | Safe interpretation |
| --- | --- | --- |
| Account/instrument position snapshot changed | Venue snapshot | Current exposure changed; not enough by itself to assign a fill to a particular play |
| A linked order/fill is reported | Venue order status and execution fact | Confirmed execution or partial execution |
| A configured level is crossed | Chosen market price feed | Price-level observation, not proof of execution |
| A historical candle spans a level | OHLC bar | Level may have been reached within that interval; the bar alone does not prove an order fill or the sequence of multiple exits |

Hyperliquid exposes distinct order statuses for triggered and filled orders, along with fill records.[3] Its TP/SL orders use mark-price triggers, and a triggered limit order can remain unfilled.[5] The model must preserve this distinction instead of turning a touched price or a chart candle into a confirmed trade.

Prefer explicit venue order IDs when linking imported facts to entry/exit plans. Account plus instrument alone can be ambiguous when multiple plays share a netted position. Unmatched facts should remain visible for review rather than be assigned by a silent guess.

The owner confirmed simultaneous plays per account/instrument. The scaffold must not enforce a unique active play for that pair. Matching must instead use explicit venue order/fill identity or an allocation confirmed under defined rules. Whether links are entered manually, suggested for confirmation, or matched under a later explicit policy still needs specification. Until then, ambiguous imported facts must remain unmatched.

## Background work and notifications

Proposed background responsibilities:

- Optional initial import with durable progress and provider-range limits.
- Incremental account/order/fill synchronization with idempotency and restart recovery.
- Instrument metadata and required candle/price retrieval, cached according to the workflow.
- Monitoring for enabled plays, with distinct execution and price-observation results.
- Notification creation and delivery.

Hyperliquid offers user fill/order and market-data WebSocket subscriptions.[4] Streams are a useful option, not a substitute for durable cursors, deduplication and recovery. Polling versus subscriptions and the scheduler/job library remain detailed design choices.

Market data gaps and disconnected feeds must produce stale/degraded monitoring state, not an assertion that no entry or exit was touched. Price-source semantics, candle ambiguity, rule revision and watch-start time should be explicit.

Share account synchronization and instrument market data between watches rather than poll the venue independently for every entry. Initial imports and reconnect snapshots must not replay old fills as new watched-play notifications. Define a watch-start boundary and deduplicate on source identity.

In-page popups are the confirmed MVP presentation. I propose small durable notification records so retry/reconnect does not repeat every popup or lose every unseen event. This is not a request to build a notification center.

Notification creation should have stable IDs and deduplication keys, typed events, owner/account/play references and evidence provenance. The frontend presents popups; future Telegram/Discord adapters consume the same notifications rather than duplicate fill detection. Delivery polling versus push, acknowledgement, retry and catch-up policy remain open.

These requirements still do not establish a need for a separate message broker. Durable jobs and notification/import records can be implemented within the proposed modular backend, with a transactional outbox when an external delivery boundary requires it.

## Questions to settle next

1. How should venue orders and fills be associated or allocated when multiple plays share the same account/instrument? Account/instrument coincidence alone is insufficient.
2. When does tracking begin, and what latency is acceptable for execution and price notifications?
3. Should initial import use a from/to range, a start date up to now, or another explicit date convention?
4. The foundation uses direct memory-only bearer entry. Is a persistent session required before production use?

Continue the bounded scaffold in [the contract](scaffold-contract.md), then define import/reconciliation, monitoring/notification, production security/ownership and financial-number specifications. Scaffold completion is not proof that those workflows exist.

## Primary references

1. [shadcn/ui ownership and composition](https://ui.shadcn.com/docs) and [Vite installation guidance](https://ui.shadcn.com/docs/installation/vite).
2. [OWASP HTML5 storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).
3. [Hyperliquid info endpoint order status and fills](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).
4. [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).
5. [Hyperliquid TP/SL trigger and execution behavior](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl).
