# Strategies: development plan

October 5, 2026. Status: **draft plan for owner refinement. Nothing here is authorized for implementation yet.**

The owner reviewed the strategy prototypes and asked for a development plan that fits the tools Vessel already has and reuses existing code, instead of the prototypes' stand-ins. The discovery record is [strategy-alternatives.md](../design/strategy-alternatives.md). The prototypes (`prototype/strategies-*.html`, `strategies-capture.mjs`, `strategies-shape-*`) are the starting point for layout and flow only. Their data, canvas drawing code and direct browser calls to Hyperliquid are disposable.

## What the owner has settled so far

- **Two concepts, two places.** *Definition* is creating and editing a strategy. *Behaviour* is how it went in the Plays that used it. Editing rules never sits next to results.
- **Strategies are generic.** A strategy describes a kind of situation, not an asset. The asset belongs to each Play.
- **Pictures explain the idea.** These are chart captures with drawings, from one or several assets, Hyperliquid by default, or uploaded images. Numbered pins tie a picture to a rule.
- The owner liked the combined shape in `prototype/strategies-flow.html`:
  - a library;
  - a strategy page with Definition, Behaviour and History;
  - a guided builder for new strategies;
  - an edit sheet over a working copy, frozen into a new version with a reason.

These rest on the domain rules already in [CONTEXT.md](../../CONTEXT.md) and the [project brief](../project-brief.md):
- A strategy is a testable hypothesis.
- A Play refers to at most one strategy version.
- A new version never rewrites past Plays.
- Outcome and process stay separate.
- Vessel never claims that a strategy works.

## Shape of the feature

| Area | What it contains | Prototype reference |
|---|---|---|
| Library | Strategies grouped by stage (Idea, Testing, In use, Shelved, Retired), each showing its one-line thesis, scope chips, the version Plays use, the first picture and a strip of its plays | `strategies-flow.html` library |
| Definition | The current version: thesis (when / expect / because), when it applies (markets text, direction, timeframes, regime, sessions), rules grouped by kind (context, trigger, entry, risk, exit, avoid; must or nice to have), invalidation, review plan (predictions, stop rule, look-back interval), pictures with rule pins, and a preview of the Play checklist | Definition tab |
| Behaviour | Read only, computed from Plays: counts including missed and cancelled plays, results in time order with version boundaries, outcome × process, which rules get broken, the review plan with the owner's own judgement, and the plays list | Behaviour tab, `strategies-review.html` (Scorecard) |
| History | Frozen versions, their reasons, and a rule diff | History tab |
| Create | A guided builder for the first write-up. It ends as an Idea (name only) or by freezing v1 | Create flow |
| Edit | A sheet over a working copy, with live "changes since vN". Freezing requires a reason. Stage changes are separate and also require a reason | Edit sheet |
| Inside a Play | The journal's Strategy tab: pick a version, answer each rule met / not met / n.a., and keep a free-text note | `strategies-concepts.html` D, agent concept 3 |

## Reuse map

| Need | Reuse | New or changed |
|---|---|---|
| Aggregate with frozen revisions and reasons | The `Play`, `PlayPlanRevision` and `PlayStatusChange` patterns (append-only, internal constructors, owner-scoped, `Restrict` FKs), `Version` concurrency token, `expectedVersion` → 409 | `Strategy`, `StrategyVersion`, `StrategyStageChange` |
| Validated JSON document | The `PlayDocuments` normalisation style (generated-regex IDs, bounded text, `WorkspaceException(400)`), jsonb columns | `StrategyDocuments` for the definition document |
| API | Minimal-API groups like `PlayEndpoints.cs`, contracts beside the port like `Plays/Contracts.cs`, ProblemDetails mapping in `Program.cs`, owner context from `IJournalOwnerContext` | `StrategyEndpoints.cs`, `Strategies/Contracts.cs` |
| Persistence | `VesselDbContext` conventions (snake_case, string enums, query filter, `ValidateOwnership`), store pattern of `PlayStore` | Tables and a migration, `StrategyStore` |
| Frontend API | `api/plays.ts` style (types plus hand-written guards), `createWorkspaceApi` | `api/strategies.ts` |
| Navigation | `ApplicationShell` hash routes and the shell-held session (like `playsSession`) | Enable the Strategies entry and replace `shell-nav-later` |
| Dirty state, reason and history dialogs | `saved.ts` (`SavedState`, `isDirty`), `PlayDialogs.tsx` (`RevisionDialog`, `HistoryDialog`) | Strategy equivalents or shared extractions |
| Chart for pictures | `CandleChart`, `ChartAdapter.capture`, `drawings.ts` (time/price anchors, `TimeIndex`), `drawingTools.tsx`, `useDrawingEditor`, `DrawingEditBar`, `ChartToolRail`, `TimeframeBar`, `useCandles` | A rule-pin drawing kind; a chart source without an account (see market data) |
| Uploaded images | `MarkupEditor.tsx`, `markup.ts`, `evidence.ts` limits and sniffing | A rule-pin markup shape |
| Image storage | `IEvidenceObjectStore`, `LocalEvidenceObjectStore`, `EvidenceImage.Detect`, `EvidenceMarkup.Normalize`, content endpoint headers, `syncEvidence` client pattern | `StrategyPicture` metadata and routes; evidence is Play-only today |
| UI primitives | shadcn `Button`, `Dialog`, `Tabs`, `Input`, Graphite tokens in `styles.css`, shell classes (`shell-panel`, `workspace-badge`, …) | A shared segmented control: `.segmented` is currently scoped to `.plays-page` |
| Play statuses and cancel reasons | `PlayStatus`, `CancelReason` (Missed counts as evidence) | — |
| Execution facts | `PlayExecutionDto`, `ExecutionTotalsDto` | Realised R per Play does not exist yet |

## Data model (proposal)

**Strategy** (aggregate root, owner-scoped):
- `Id`, `OwnerId`, `Name`, `Stage`, `CurrentVersion` (nullable until v1);
- `Working` (jsonb definition document; null when it equals the current version);
- `ReviewPlan` (jsonb, not versioned, see decisions);
- `CreatedAtUtc`, `UpdatedAtUtc`, `Version` (concurrency token).
- Methods: `EditWorking(definition)`, `Freeze(reason, now) → StrategyVersion`, `ChangeStage(stage, reason, now) → StrategyStageChange`, `Rename`.
- Rules: freezing needs a name, a thesis "when", at least one trigger or entry rule, an invalidation and a reason. Testing and In use need a frozen version.

**StrategyVersion** (append-only, like `PlayPlanRevision`): `Number`, `Definition` (jsonb snapshot), `Reason` (≤2000), `CreatedAtUtc`.

**StrategyStageChange** (append-only, like `PlayStatusChange`): `From`, `To`, `Reason`, `OccurredAtUtc`.

**Definition document**, validated in Application:
- `thesis {when, expect, because}`;
- `scope {markets, direction: long|short|both, setupInterval, entryInterval, regimes[], sessions}`;
- `rules[{id, kind, text, required}]` (≤40);
- `invalidation`.

Rule IDs are stable across versions, so diffs show reworded rather than replaced rules, and Play checks keep meaning. Rule numbers shown to the owner are derived from display order, never stored.

**StrategyPicture**, owner-scoped and not versioned:
- `Id`, `StrategyId`, `Kind` (example | counterexample | explains), `Caption`, `RuleIds[]`, `DrawnForVersion`;
- `Source` (capture | upload) plus capture context (venue, instrument, interval, time range);
- object key in `IEvidenceObjectStore`, type, size, SHA-256;
- `Markup` (uploads), or the chart `drawings` JSON (captures, so a picture can be re-opened and edited).
- Keys: `{owner}/strategies/{strategyId}/{id}.{ext}`.

**Play link**, added to the plan document:
- `strategy: {strategyId, version} | null`;
- `ruleChecks: {ruleId: met | broken | na}` answered at planning;
- the existing `notes.strategy` stays as the Play's free-text strategy note.

Choosing or changing the version after planning is a plan change and needs a revision reason, so the original intent stays visible. Post-trade adherence is part of the Review step (delivery step 3 in [play-lifecycle.md](play-lifecycle.md)).

## Market data for pictures

Candles, the instrument catalogue and the live stream are routed per account today (`/api/accounts/{id}/candles|instruments|market-stream`, guarded by `MarketDataGuard`). Generic strategies have no account.

Proposal: add account-free routes for public venue data, `GET /api/markets/hyperliquid/instruments` and `GET /api/markets/hyperliquid/candles`. They would reuse `CandleService`, `ICandleReader`, `CandleCache` and the existing `IPerpetualVenueReader` catalogue, with the same bounds (≤500 candles, validated interval and instrument), and are still authenticated. The live stream is not needed for pictures. The alternative is to borrow the first enabled Hyperliquid account, which fails when there is none and mixes account and market concerns.

## Behaviour read model

`GET /api/strategies/{id}/behaviour?version=` returns, per Play using the strategy:
- Play ID, title, instrument, version, status and cancel reason;
- rule checks, and derived process (followed / deviated / not reviewed);
- outcome (positive / flat / negative / no trade / in progress), from closed execution facts;
- dates.

Aggregates are counts only. The page draws the strip, the matrix and rule adherence from these rows. It makes no rates, verdicts or "edge" claims and always carries the sample-size caveat.

Gap: results in R need a defined planned risk and realised result per Play. None exists today (`PositionSummary` shows "Not calculated"). Until it does, outcome comes from the sign of the venue-reported closed PnL, and the R chart waits.

## Delivery steps and tasks

Each step follows the existing pattern:
- a contract section before work starts;
- a dated state section with verification after it;
- `pnpm check`;
- a headless Chromium run against a real API and a scratch database at 1402, 1001 and 390 px.

### Step 1: Strategy definition, backend

| ID | Task | Reuses | Depends on |
|---|---|---|---|
| S1.1 | Domain: `Strategy`, `StrategyVersion`, `StrategyStageChange`, `StrategyStage` enum, rule exceptions; domain tests | `Play` and revision patterns | — |
| S1.2 | `StrategyDocuments`: normalise and validate the definition and review plan (bounds, IDs, kinds, required-for-freeze checks); tests | `PlayDocuments` | S1.1 |
| S1.3 | Persistence: DbContext mapping, `ValidateOwnership` cases, `StrategyStore` with 409 on concurrency, migration `Strategies` | `VesselDbContext`, `PlayStore` | S1.1 |
| S1.4 | `StrategyService` and endpoints: `GET/POST /api/strategies`, `GET/PUT /api/strategies/{id}` (working copy, `expectedVersion`), `POST …/freeze {reason}`, `POST …/stage {stage, reason}`, `GET …/history`, `DELETE` (only Ideas with no Play references) | `PlayService`, `PlayEndpoints` | S1.2, S1.3 |
| S1.5 | Tests: service with a memory store, PostgreSQL store tests, API tests, architecture tests stay green | `PlayTests` patterns | S1.4 |

### Step 2: Strategy pages, frontend

| ID | Task | Reuses | Depends on |
|---|---|---|---|
| S2.1 | `api/strategies.ts`: types, guards, client calls; fixtures | `api/plays.ts`, `test/*-fixture.ts` | S1.4 |
| S2.2 | Shell: enable Strategies, hash route, shell-held session (keeps an unsaved working copy across navigation, like Plays); update `ApplicationShell.test.tsx` | `ApplicationShell`, `PlaysSession` | S2.1 |
| S2.3 | Library page: stage filters and groups, rows with thesis, scope chips, version and play count (picture thumbnail and play strip arrive with steps 3 and 5) | Shell panels, badges | S2.2 |
| S2.4 | Strategy page: header with stage and reason, Definition tab (read-only current version, Play checklist preview), History tab (versions, reasons, rule diff by rule ID) | `Tabs`, `HistoryDialog` diff ideas | S2.3 |
| S2.5 | Editor: one component used two ways, as a guided builder for new strategies (steps: idea, when it applies, rules, wrong & review, save) and as a sheet for edits. Live changes list, freeze dialog with reason, stage dialog with reason, discard. Extract a shared segmented control | `RevisionDialog`, `saved.ts` dirty tracking | S2.4 |
| S2.6 | Tests (Vitest), then the browser run | — | S2.5 |

### Step 3: Pictures

| ID | Task | Reuses | Depends on |
|---|---|---|---|
| S3.1 | Account-free market routes for Hyperliquid instruments and candles; tests | `CandleService`, `ICandleReader`, `CandleCache`, `IPerpetualVenueReader` | — |
| S3.2 | `StrategyPicture` entity, migration, routes (`GET/POST /api/strategies/{id}/pictures`, `GET /api/strategy-pictures/{id}/content`, `PATCH` caption/kind/rules, `PUT` drawings or markup, `DELETE`), limits under `Vessel:Evidence` | `IEvidenceObjectStore`, `EvidenceImage`, `EvidenceMarkup`, `EvidenceEndpoints` headers | S1.4 |
| S3.3 | Rule pin: a `rule-pin` drawing kind in `drawings.ts` (one point plus `ruleId`; label is the derived number; schema version handling) and a `rule-pin` markup shape in `markup.ts` and `EvidenceMarkup` | `drawings.ts`, `drawingController.ts`, `drawingTools.tsx`, `markup.ts` | — |
| S3.4 | Picture studio: a dialog with `CandleChart` fed by S3.1 (instrument picker from the catalogue, `TimeframeBar`, scroll back), the existing drawing rail plus rule pin, capture through `ChartAdapter.capture`, or upload then `MarkupEditor`. Side panel for kind, caption and rules | `CandleChart`, `useDrawingEditor`, `MarkupEditor`, `evidence.ts` | S3.1–S3.3 |
| S3.5 | Picture viewer on Definition: hovering a rule highlights its pin; thumbnails in the library, builder and sheet; client sync after save | `syncEvidence` pattern | S3.4, S2.5 |

### Step 4: Strategy inside a Play

| ID | Task | Reuses | Depends on |
|---|---|---|---|
| S4.1 | Plan document: `strategy {strategyId, version}` and `ruleChecks`; validation that the version exists and is owned; revision rules; `describePlanChanges` text | `PlayPlanDocument`, `PlayDocuments`, `saved.ts` | S1.4 |
| S4.2 | Journal Strategy tab: version picker (Testing and In use first), checklist met / not met / n.a. with rule numbers and a picture peek, free-text note kept. A newer version is shown but never applied automatically | `WorkspacePanels.tsx` journal | S4.1, S3.5 |
| S4.3 | Strategy references block deleting a strategy version that Plays use; Idea strategies cannot be picked | — | S4.1 |

### Step 5: Behaviour

| ID | Task | Reuses | Depends on |
|---|---|---|---|
| S5.1 | Behaviour endpoint (rows and counts as above), owner-scoped, version filter | Plays query, `PlayExecutionDto` totals | S4.1 |
| S5.2 | Behaviour tab: count tiles (missed and cancelled separate), play strip with version boundaries, outcome × process matrix filtering the plays list, rule adherence, review plan with the owner's judgement per prediction, plays list linking to the Play; library play strip | Validated chart colours from the prototype (`--pos-mark #20a090`, `--neg-mark #d96a4a`) | S5.1 |
| S5.3 | Pin a Play as an example or counterexample from Behaviour; it shows its own evidence on the Definition | Play evidence content route | S5.2 |

### Later candidates (from the idea pages, not planned yet)

- "From a real example": start a strategy from a past Play's capture.
- Pre-flight: dry-run rules on past plays, outcomes hidden, to find vague rules.
- Rule diagnostics and the plays × rules ledger.
- Version comparison.
- The evidence journal view.
- Results in R once planned risk and realised result are defined.
- Post-trade adherence inside the Review record (lifecycle step 3).

## Decisions to refine with the owner

1. Do rule checks belong to planning only, or are they answered again in the review? Is "unsure" allowed?
2. Is a version required when planning a Play that uses a strategy, or can a Play keep only the free-text note?
3. Is the review plan versioned with the definition, or editable at any time (proposed: editable, not versioned)?
4. Are the stage names and meanings (Idea, Testing, In use, Shelved, Retired) right, and does Retired hide a strategy from the Play picker?
5. Are account-free market routes acceptable, or should pictures need a connected Hyperliquid account?
6. Picture limits per strategy and per file, and whether captures keep their drawings for re-editing (proposed: yes).
7. Do pinned Plays and pictures live in the same Pictures list, or separately?
8. Which outcome definition is used until R exists (proposed: sign of the venue-reported closed PnL, with "flat" as a small band to agree)?
9. Can a strategy be deleted once any Play used it (proposed: no; retire it instead)?

## Risks

- **Rule IDs must stay stable** across versions and duplicates, or diffs and Play checks lose their meaning. The editor must never reassign IDs on reorder.
- **Picture numbering** is derived from display order, so reordering rules renumbers pins. Pins store the rule ID; images rendered earlier keep the old number until re-captured, unless pins are drawn as an overlay at display time. Captures keep their drawings so they can be re-rendered.
- **Small samples:** every Behaviour element needs the sample caveat and must avoid rates and verdicts.
- **Canvas testing:** canvas is not testable in jsdom. Chart and picture work needs the browser run, as the chart work did.
