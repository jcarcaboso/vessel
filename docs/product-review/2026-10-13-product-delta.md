# Vessel product delta

October 13, 2026. Compare `a51c7f2` with `7559248f838068faff8cf8146844a031bc2a67c9`.

This is a product review, not implementation authorization. It updates the judgments in [trader-review.md](trader-review.md), [roadmap.md](roadmap.md) and [competitors.md](competitors.md). Their M, G, I, N and X identifiers remain useful, but their descriptions of Vessel are historical.

## Verdict

The October 2 diagnosis no longer describes Vessel. Saving and result measurement are implemented. A trader can save a plan and evidence, revise it with a reason, link supported venue orders, follow linked executions into closure, write a review and inspect closed-Play performance. Activity also makes imported executions useful without inventing a Play. Those capabilities need to be distinguished from the correctness defects reported by the other reviews. See S01, S02, S05 and S06.

Correctness comes first. The main review reports five confirmed backend defects, including B3 and B4 reproduced through real HTTP against isolated PostgreSQL, plus a P2 case where evidence-note edits made during save are lost. Resolve and regression-test those findings before expanding the product. This review did not independently reproduce them or investigate their causes; the backend audit and main report own the details.

After that, the strongest product priorities are:

1. Complete the manual execution lifecycle and give imported activity an explicit retrospective-review path. A saved manual plan cannot currently record what happened.
2. Complete the aggregate money summary using the existing per-entry calculations. Do not rebuild the implemented clamp, liquidation estimates or warnings.
3. Add a short structured review to the existing journal and Needs review queue.

The eight opportunities later in this file preserve the requested roadmap comparison, not eight concurrent commitments. Tracking, protection and cost provenance follow the proven gaps. Strategy versions, retrieval/export and the nice-to-haves need separate prioritization. More indicators, simulation and AI can wait. This ordering is my product recommendation, not a claim that these features improve trading returns.

## Scope and evidence

- I read the project brief, `CONTEXT.md`, the approved layout baseline, current workflow contracts and the historical review documents. I checked the commit range and traced the production frontend and its API contracts. S01 to S18 below identify concrete source files.
- "Shipped" means implemented in the target commit. It does not establish that the owner has published images, upgraded an installation or exercised every venue.
- I did not run the application, tests, migrations or live account reads. I did not access `.env`, a private database or tracking systems. Browser testing and the backend bug audit belong to the other reviews.
- The main review supplied browser confirmation of saved/planned manual and Hyperliquid workflows, the BTC leverage clamp from 100 to the loaded maximum of 40, wrong-side save blocking and a liquidation warning. It also confirmed that a planned manual Play offers pause/cancel, not manual fills or an outcome-entry workflow. These are supplied observations, not tests I ran.
- The main review also supplied the correctness findings summarized above. "Implemented" in the tables does not overrule those defects or claim that saving is currently safe in every race.
- Absence claims mean no implemented workflow found in the inspected production code and current contracts. They do not mean a feature is impossible or that a prototype is absent.
- Current external facts used here were checked against official Hyperliquid documentation. Exact URLs and limitations are at the end. Competitor prices, rankings and claims of unique capabilities were not refreshed.

The boundaries remain unchanged: locked desktop section positions and shared responsive stack, single owner, read-only venue access, no order routing, concurrent Plays on the same account/instrument, and separate plan, execution and observation records. Portfolio membership is current grouping, not historical attribution. Unknown money or risk remains unknown.

## What changed since the old review

| Area | At the earlier review | At the target commit |
| --- | --- | --- |
| Saved work | Play editor held an in-memory draft; server evidence lacked a creatable Play parent. | Save/load, status actions, reasoned plan revisions, history diffs and evidence synchronization. Unsaved edits still need an explicit save. S01, S07 |
| Execution | Fills had no usable plan-link workflow. | Automatic unambiguous order linking, owner confirmation for ambiguous matches, manual order selection, execution totals and fill-driven Open/Closed states. Checks run for the viewed tracked Play, not as a durable background service. S02 |
| Planning arithmetic | Most summary figures and the sizing assistant were placeholders. | Margin, quantity, notional, per-exit estimates, per-entry R:R, risk-based suggestions, budget checks, venue leverage clamp, isolated liquidation estimates and warnings. The aggregate loss/reward summary is still unfinished. S03, S04 |
| Imported activity | Flat fill rows. | Position operations with execution drill-down, filters, native-contract separation, flip allocations, Mixed/Unassigned associations and coverage. These are facts, not retrospective Plays. S06 |
| Performance | No production analytics page. | Review for eligible saved closed Plays, with periods, groups, P&L, payoff, profit factor, expectancy, drawdown, streaks, estimated R, coverage and contributing Plays. S05 |
| Overview | Mostly balance/count context. | All/portfolio/Unassigned/account scope; grouped balance, availability, unrealized P&L and retained closed-operation results; scoped recent operations and saved Plays. S08 |
| Account organization | More individual account management steps. | Account filters, sequential Refresh all, custom portfolio icons, bulk move/unlink, create-with-accounts, inline portfolio creation and stale-selection conflict handling. S09 |
| Venues | Hyperliquid-first baseline. | Production RISEx and bounded Lighter account discovery/import, manual candles and optional verified read-only Lighter order access. Capability-driven controls replace assumptions that every venue supports the same reads. S10 |
| Chart and appearance | Existing candles, drawings, captures and markup. | Plan tools, multiple stops, EMA/Volume/RSI, chart favorites, session-only candle caching, frame-batched interactions, built-in dark/light themes and a browser-local theme builder. S11, S12 |
| Operating Vessel | Development-oriented deployment. | Linux amd64 v0.1.0 packaging, explicit one-shot migrations, proxy/TLS guidance and database/evidence/key backup and isolated-restore procedures. Publication remains manual. S13 |

Two new screens can legitimately disagree about results. Overview sums eligible closed position operations, including activity without Plays. Review scores eligible saved closed Plays with linked executions. They also offer different time-window choices. Neither is total account return or a funding-complete equity curve. Explain that distinction before suggesting that one screen should be made to match the other. S05, S06, S08.

## M1 to M10, reassessed

Status applies to the whole old item, not just its headline. Partial means a useful part exists, with the remaining boundary named.

| ID | Status | What exists and what remains |
| --- | --- | --- |
| M1 Save, revisions, frozen context | Partial | Saving, reopening, reasoned plan revisions, history and saved evidence are implemented. Automatic market/candle snapshots at planning and first fill are not. Capture context metadata is not fully restored with saved evidence. There is no archive action; deletion is for Drafts. Do not rebuild persistence or assume unsaved work survives reload. S01, S07 |
| M2 Risk-first sizing and money summary | Partial | Suggestions, size conversions, venue-max leverage clamp, per-entry R:R, per-exit gain/loss, isolated whole-plan and entry-alone liquidation estimates, and warnings are implemented. `PositionSummary` still lists only margin, position size, quantity and average entry. It lacks aggregate all-stops loss/all-targets profit, aggregate R:R and risk share of a stated reference. Fee/slippage inputs, margin-mode selection and a worst-fill-path leverage recommendation are not implemented. S03, S04 |
| M3 Portfolio heat | Missing | Portfolio balances, notional exposure and reported positions are useful inputs, not an open-risk report. There is no known-risk-plus-unknown-risk total across concurrent Plays and unmatched venue exposure. Correlation/beta adjustment is also absent and should not be the first slice. S03, S08 |
| M4 Management and invalidation rules | Partial | Invalidation/strategy notes, multiple stops/targets and plan revision reasons exist. Structured after-target rules, time stops, condition-based invalidation, stop scope and per-rule adherence do not. Existing notes should remain available. S01, S03, S14 |
| M5 Fills into operations, links and inbox | Partial | Activity now derives operations and exposes executions. Saved Plays can link orders and receive their fills. There is no import-to-retrospective-review inbox, classification workflow or supported conversion of an operation into reviewed intent. Operations containing multiple Plays remain Mixed; do not force one operation to equal one Play. Funding attribution, dedicated liquidation flags and TWAP/builder-fee review affordances are not the completed old proposal. S02, S06 |
| M6 Protection check | Missing | Linked stop orders and order quantities can be inspected in Execution, but no workflow answers whether the current venue exposure has a compatible, sufficiently sized reduce-only stop. A plan's liquidation warning is not a protection check. S02, S03, S15 |
| M7 Outcome in R | Partial | Review displays an R estimate for qualifying pre-entry plans and exposes risk coverage. Its denominator is executed entry notional times planned share-weighted stop distance, not reconstructed risk for each actual fill path. Separate funding payments, sizing error and entry/exit slippage comparisons are absent. Imported activity without a pre-trade plan does not receive fabricated R. S05 |
| M8 Structured one-minute review | Partial | Saved free-text review, Overview's Needs review tab and written-review counts exist. Adherence, optional mistake/emotion tags, a lesson field, explicit retrospective origin and review amendment history do not. A nonblank note is not evidence of good process. S01, S05, S14 |
| M9 Soft limits and behavior signals | Partial | The owner-approved exposure ladder reduces suggested size after losses and offers explicit Accept actions. That is not daily/weekly loss limits, portfolio heat limits, trade-frequency observations or a cooldown-note workflow. Old numeric defaults remain proposals, not accepted policy. S04 |
| M10 Analytics with sample honesty | Partial | Real production performance analytics, contributing counts, small-sample labels and risk/fee/execution coverage now exist. Setup, adherence and mistake comparisons cannot exist meaningfully until those records exist. Standard errors, R-based curves/expectancy and process-versus-outcome analysis remain absent. More metrics are lower value than collecting the missing review inputs. S05 |

The approved lifecycle supersedes G4's old vocabulary. Vessel uses Draft, Planned, Paused, Open, Closed and Cancelled. "Missed" is a cancellation reason, and review is independent of status. Do not reintroduce Reviewed as a lifecycle state or infer closure from a flat venue position alone. S01, S02.

## Important next, nice-to-have and competitor ideas

### Important-next items

| ID | Status | Remaining product boundary |
| --- | --- | --- |
| G1 Automatic context tags | Missing | Live context and execution timestamps are not saved session/regime/event tags. Start only with deterministic facts and explicit provenance. S07, S15 |
| G2 Setups/playbook; G3 checklist | Deferred | Generic strategies, separate Definition/Behaviour and frozen versions have a draft plan, not a mounted implementation. The Play Strategy tab is free text. S14 |
| G4 Lifecycle | Shipped within approved scope | Status actions, revisions, cancellation reasons and fill-driven progress exist. Manual execution entry and the separate review-history step remain unfinished. S01, S02 |
| G5 Missed-setup observations | Partial | Missed/cancelled reasons and notes can be retained. Post-cancellation price-path analysis does not exist. S01 |
| G6 Price alerts | Deferred | Toast infrastructure and live chart data do not implement level watches or durable notifications. S02, S16 |
| G7 Actual position on chart | Missing | Chart overlays show planned levels and estimated liquidation, not linked fill markers and a separately labeled venue-position average/liquidation overlay. S15 |
| G8 MAE/MFE | Deferred | No frozen candle history or excursion workflow. The proposed archive needs its own contract; session caching is not archival storage. S07, S11 |
| G9 Liquidity/slippage estimate | Missing | No order-size impact workflow. Keep behind aggregate planning risk and explicit assumptions. S03, S15 |
| G10 Duplicate/templates | Missing | No saved-Play duplication or template workflow. A safe duplicate must omit execution links and review/outcome, and start as a new Draft. S01 |
| G11 Search/filter/saved views | Partial | Accounts and Activity have filters; Review and Overview have scope controls. Plays has only In progress, Closed and cancelled, All. No journal full-text search or saved query library. S01, S05, S06, S09 |
| G12 Daily journal | Missing | Notes are attached to individual Plays, not a day record. S14 |
| G13 Review cadence | Partial | Needs review is a useful queue for saved ended Plays. It has no scheduled prompt or weekly synthesis, and it excludes unassigned imported activity. S05, S08 |
| G14 Export and backup | Partial | Operator backup/restore is documented and individual evidence images download. No portable journal export with structured records and notes, or redacted mentor review. S07, S13 |
| G15 Manual executions/CSV import | Missing | Manual accounts and manual-instrument plans exist. They do not let the trader record actual fills/outcomes or import a statement. S01, S09 |

### Improvements to existing workflows

| ID | Status | Delta |
| --- | --- | --- |
| I1 Leverage limit | Shipped clamp | The editor clamps whole-number input to the venue maximum. Do not list 100× everywhere as a current defect. A risk-aware recommendation is a different feature. S03 |
| I2 Level meaning | Partial | Inputs now mean return at leverage, and helpers show underlying price move plus per-exit money. Planned/initial/realized R labels across the workflow are not complete. S03, S05 |
| I3 Unit conversion | Partial | Margin/quantity conversion preserves the intended position when computable. The SL/TP price-percent switch still clears its value. Changing that is an owner decision; conversion must use the current leveraged meaning, not the old roadmap's unlevered example. S03 |
| I4 Shares and validation | Partial | Entry split helpers and an allocation total exist; wrong-side levels and draft over-budget checks block save/planning. A complete, explainable entry/exit coverage check is not equivalent to these checks. Decide draft-save versus Plan it rules explicitly. S03 |
| I5 Fixed Draft badge | Shipped replacement | Real status actions and badges replace the old placeholder. S01 |
| I6 Drawing into plan | Partial | Dedicated plan tools create/edit entry/stop/target levels. An independent position drawing is still a measurement, not a linked execution or a documented drawing-to-entry conversion. S15 |
| I7 Structured journal | Partial | Rich evidence and Execution joined the journal, but decision/review fields remain text. S14 |
| I8 Readable Activity | Partial | Operations, filters and execution expansion are implemented. Responses are capped and do not paginate; client filters cannot retrieve omitted older operations. S06 |
| I9 Useful Overview | Partial | Scoped balances/results, operations and Needs review exist. Adherence and known/unknown open risk do not. S08 |
| I10 Timely refresh | Partial | Sequential Refresh all and visible-Play execution polling exist. Neither continues as reliable server-side monitoring with the browser closed. S02, S09 |
| I11 Evidence export includes notes | Missing | Download exports the original image or flattened markup, not the accompanying note. S07 |

### Nice-to-haves

| ID | Status | Recommendation |
| --- | --- | --- |
| N1 Streak/risk simulation | Missing | Wait for adequate, clearly scoped records and an agreed model. Do not repeat the old probabilistic example as a current product guarantee. |
| N2 Replay | Deferred | Specify retained history first. Do not build replay on a session cache. S11 |
| N3 Telegram/Discord | Deferred | Build reliable event records and delivery state before adding another channel. S16 |
| N4 Generated weekly review | Missing | A short deterministic summary can follow structured reviews; it does not require AI. S05, S14 |
| N5 AI review assistant | Deferred recommendation | No production feature found. Keep opt-in/private and behind usable inputs and export. Never generate original intent. |
| N6 Calendar heatmap | Partial foundation | Review has daily/bucketed P&L charts, not a calendar or daily R heatmap. Reuse those results rather than add another calculation path. S05 |
| N7 Lighter | Shipped, bounded | Discovery, separate main/subaccounts, public reads and optional verified read-only order access exist. No Lighter live chart/context; import does not automatically refresh history. S10 |
| N8 Configurable themes | Shipped | Built-in dark/light themes, custom colors, readability checks and named browser-local palettes. More theme work is optional. S12 |
| N9 Mobile quick capture | Partial | Responsive upload/evidence forms exist. No dedicated share-target, offline capture or cross-device draft handoff. Browser comfort belongs to the UX report. S07 |
| N10 Command palette/shortcuts | Partial | Chart undo/redo and tool favorites exist; no global command palette or complete proposed hotkey set. S11, S15 |
| N11 Hyperliquid breadth | Partial | Account-mode-aware stablecoin handling exists. HIP-3 catalogues and dedicated subaccount/vault discovery are not the completed integration. Do not confuse Lighter discovery with Hyperliquid breadth. S10, S17 |

### Competitor-derived additions

| ID | Status | What to carry forward |
| --- | --- | --- |
| X1 Counterfactual management | Deferred | Needs management rules and adequate stored price history. Same-candle stop/target order must remain ambiguous. |
| X2 User-defined auto-tags | Missing | Begin with readable fact rules, not labels that assert emotion or intent. Depends on a tag/review model. |
| X3 Funding payment attribution | Missing | Live funding rates are not cashflows. Keep reported position/account funding separate from an allocation among concurrent Plays. S05, S17; E2 |
| X4 Cashflows versus performance | Missing ledger workflow | Existing closed-operation/Play P&L avoids claiming balance growth is performance. Deposit/withdrawal reconciliation and cashflow-adjusted account returns are absent. S05, S08; E2 |
| X5 History and coverage | Partial | Account notices and result exclusions exist. Deeper backfill and scheduled incremental retention do not. Never label an earliest retained fill "complete since" without continuity evidence. S06, S10, S17; E1 |
| X6 Liquidation-distance alert | Missing | The isolated planning line is not a live alert based on the venue's reported liquidation value. S03, S15; E3 |
| X7 Methods/versioned definitions | Partial | Review has a Definitions dialog and coverage explanation. It does not version every method or explain all screens through one shared methods view. S05 |
| X8 External read-only data access | Partial foundation | Authenticated GET routes exist. A separately scoped read-only credential, stable export contract or local MCP is not implemented. Do not hand a write-capable owner token to another tool as the finished feature. S01, S05 |
| X9 Redacted review export | Missing | Start with one Play plus evidence and notes, with explicit redaction choices, before any sharing service. S07, S13 |

No current vendor-price or competitive-superiority conclusion follows from the old comparison. Its useful contribution here is the list of workflow ideas, not proof that another product still lacks them.

## Eight highest-value remaining ideas

These are proposed slices with testable acceptance, not a new committed roadmap. They follow, rather than compete with, the confirmed correctness repairs. Item 1 is the first workflow gap to close; item 2 completes an approved workspace goal; item 3 completes the reflection workflow. Items 4 to 8 need additional policy or scope decisions and can wait. The smallest useful versions reuse the existing screens.

### 1. Get imported and manual activity into review

A trader connects an account after trading for several months. Activity shows closed operations and Overview shows a realized result, but Review has no scored Plays. Another trader plans on a manual venue, executes elsewhere and cannot record the fill that would take the Play beyond Planned.

Start with an explicit "Review this activity" action, plus a separately labeled manual-execution path. Reuse Activity drill-down and the existing journal rather than create a competing trade editor. M5, G15 and S01/S02/S06 are the starting points.

Acceptance:

- A closed imported operation can start a retrospective record after the owner inspects its constituent executions. Original fills remain unchanged.
- No original thesis, pre-trade stop or risk denominator is manufactured. The form states when the review was written and why R is unavailable.
- A Mixed operation exposes its Play associations and unassigned portions. The action never silently assigns the whole net position to one concurrent Play.
- A manual fill records source, time, price, quantity and fees with validation and edit history. A typed result is never labeled venue-confirmed.
- Unsupported/incomplete operations explain what is missing instead of creating an apparently complete record.

Decide the retrospective record and manual-execution model before implementation. "Mark closed" alone would hide the missing facts.

### 2. Finish the whole-position money summary

A trader uses two entries and split exits. Each row has an estimate, but the trader still has to add the amounts to answer "What does this plan lose at all stops, and what does it gain at all targets?" M2, I2/I4 and S03/S04.

Start by reusing the existing calculations in the bottom Summary. Leave the chart, journal, editor and capital strip where they are.

Acceptance:

- Aggregate planned loss, reward, R:R and risk share name their reference and assumptions. They reconcile with the visible entry/exit quantities and amounts.
- An incomplete entry/exit share shows missing coverage. It never becomes zero loss or a silent normalized complete plan.
- A wrong-side level points to its editor. Preserve the implemented leverage clamp and liquidation warnings.
- Fees and stop slippage are either explicit assumptions included in the estimate or clearly excluded. Funding is not inferred from a present rate for an unknown holding period.
- Margin-mode labeling distinguishes an isolated scenario from the selected account's actual cross-margin exposure. No field says "safe leverage" or promises maximum loss.

The old roadmap's save-any-draft rule is not current behavior. Decide deliberately whether incomplete/inconsistent work can be saved as a Draft while Plan it has stricter checks.

### 3. Finish the one-minute review and its queue

A losing Play followed every rule; a winning one broke the stop rule. Today both can have a written note, but Vessel cannot distinguish process from outcome without rereading prose. M8, G13 and S05/S14.

Start inside the existing Review tab with adherence, optional mistake tags, what changed and one lesson. Reuse Overview's Needs review list.

Acceptance:

- Closed and Cancelled Plays can receive a review without editing the frozen plan. N/A is available when there was no pre-trade plan.
- Saving and later amending a review preserves who/when/reason provenance appropriate to the single-owner product.
- A dedicated review-queue filter opens the relevant record, preserves unsaved work and updates only after a successful save.
- Written, reviewed and adherence are separate concepts. No score derives "good process" from a profitable outcome.
- Retrospective records from item 1 enter the queue without a fabricated pre-trade checklist.

Keep free text. Do not require an emotion score or every possible tag before the owner can finish.

### 4. Show protection observations and known/unknown open risk

A trader has two concurrent BTC Plays and an unmatched venue position. Some stop orders are linked, others are absent or stale. Inspecting separate order rows does not answer what exposure has observed stop coverage. M3, M6, G7 and S02/S08/S15.

Start with a manual-refresh observation on the existing Execution tab and a compact capital-context total. Do not begin with beta estimates or automatic stop management.

Acceptance:

- Show planned stop quantity, observed compatible stop quantity, their difference and the observation time.
- Distinguish missing protection, unknown order access, stale data and an observed mismatch. None confirms execution.
- Known planned risk and unmeasured exposure appear separately. An unlinked position or unknown stop contributes an unknown count, not zero.
- Concurrent Plays do not double-count the same venue net position or claim exclusive ownership of a position-level stop.
- Optional chart markers distinguish actual linked fills, venue position references and planned levels visually and in labels.

A compatible order remains an observation, not assurance that a stop will execute at its planned price. Venue-specific order semantics need a contract before claiming coverage.

### 5. Make tracking freshness and history coverage actionable

A trader closes the browser overnight or has enough executions to exceed a provider's recent-history window. Refresh all is helpful, but it does not mean Vessel was monitoring while absent. I10, G6, X5 and S02/S09/S10/S16.

First show tracking state and coverage in one place using existing metadata. Then specify a bounded server-side sync/watch job, not a new broker or platform.

Acceptance:

- Account and Play views distinguish last successful refresh, current check, failure, unsupported access and tracking that is not running.
- History requests expose requested/retained ranges, provider/display limits and known gaps. "All" is explicitly all retained facts.
- Opt-in server tracking survives a closed browser, deduplicates events and does not replay historical imports as fresh fill notifications.
- Execution events and price observations have different labels, timestamps and sources; a stale feed produces unknown observation state.
- Activity can page/query beyond its displayed cap before presenting a historical filter as exhaustive.

E1 confirms a deeper Hyperliquid time-based fill endpoint exists, but still has a finite horizon. Retention/backfill needs venue-specific limits, not an "import all history" button that promises too much.

### 6. Put cost and R provenance beside every result

A trader asks why a fill-derived Play result differs from the account balance change, or why one Play has no R. The explanation should be available from the figure, not require reading source code. M7, X3/X4/X7 and S05/S08/S17.

Begin with consistent labels and a result breakdown. Add funding/ledger imports only through a separately approved accounting contract.

Acceptance:

- A result identifies its unit of analysis, included executions, fee basis, funding treatment, exclusions, report time and selected window.
- Review keeps its current "initial planned-risk estimate" label. It never relabels that denominator as reconstructed actual risk.
- Future funding reads retain the venue fact. Any split among concurrent Plays is visibly allocated, with its method, or stays at account/position level.
- Deposits, withdrawals and transfers do not count as trading gains. Unsupported currencies and unknown funding basis remain explicit.
- A changed R/accounting method is distinguishable from the old one. Existing sizing behavior is not silently changed to match Review.

E2 verifies Hyperliquid exposes funding and non-funding ledger histories. It does not establish lifetime coverage or solve Play attribution. RISEx's funding inclusion remains unresolved.

### 7. Add the smallest useful strategy-version and checklist flow

A trader repeats a range-reclaim idea across several assets. Today the Strategy tab is text, so there is no reliable way to compare the same rules before and after an edit. G2/G3, M4 and S14.

Use the settled generic-strategy model. A name, hypothesis, few rules, one explanatory picture and a frozen version are enough for a first slice; the entire discovery prototype is not required.

Acceptance:

- A Play selects a strategy version. Editing the strategy cannot rewrite the rules attached to old Plays.
- Rules describe a setup, not a hard-coded asset. Pictures illustrate it and keep their notes.
- Definition editing and Behaviour results stay separate. Checklists record met/not met/N/A without preventing external trading.
- Review compares outcomes only for eligible records, names the version and shows sample count and missing coverage.
- A rule change requires a reason; performance does not automatically promote a strategy or claim it works.

Implementation still needs owner authorization. Do not quietly ship the prototype's browser-to-venue calls.

### 8. Make saved work easier to find, reuse and take away

A trader wants the last "failed reclaim" note, a fresh draft based on a previous plan, and a review packet for a mentor without wallet addresses or dollar amounts. Persistence exists, but retrieval and portability remain thin. G10/G11/G14, I11, X9 and S01/S07/S13.

Start with title/instrument/account/status/needs-review filters in Plays and a one-Play export. Duplicate-to-Draft can reuse the same plan-copy boundary.

Acceptance:

- Search/filter results state their loaded scope. Older records remain reachable through bounded paging rather than a silent list cap.
- A duplicate has new identities and no execution links, result or review. The source Play remains untouched.
- Export includes notes beside evidence, plan/revision provenance and coverage. Original images and markup remain distinguishable.
- Redaction preview names the fields removed. Credentials never enter an export.
- UI copy distinguishes saved Play data, unsaved changes, pending image synchronization and browser-only preferences.

The supplied evidence-note save-race finding is a prerequisite, not an export feature: an edit made while a save is pending must remain in the editor and visibly dirty if it was not included in that save. Reproduce the reported sequence and add a regression check before claiming that the save workflow preserves newer work.

The deployment guide already covers operator backups; do not rebuild that work as if it were absent. A user export is not a substitute for restoring database, evidence and separately protected credential keys.

## Small corrections worth doing before another large feature

### Correct the categorical cross-margin tooltip

The supplied browser observation matches the source. `frontend/src/features/plays/PositionEditor.tsx:178` says "Cross margin liquidates further away." The same assertion appears in `EntryForm.tsx:142` and the comment in `sizing.ts:183`; `docs/architecture/plays-workspace-contract.md` repeats it.

Official Hyperliquid docs state that cross collateral is shared, and liquidation depends on account value, maintenance requirements and other positions' unrealized P&L. My inference is that the categorical comparison is unsupported; additional collateral is not an unconditional distance guarantee. See E3.

Suggested replacement:

> Isolated-margin estimate for the planned fills; excludes fees, funding and margin tiers. Cross-margin liquidation depends on account collateral and other positions, so this estimate does not apply. Check the venue-reported value for an open position; that value can change.

Retain the existing estimate and warning. This is a wording correction, not a request to remove the feature or to invent a cross-margin calculator. The main review owns the finding; no app changes were made here.

### Make screen scope and onboarding copy match the shipped workflows

- Settings still says no venue credential or automatic Play matching is involved, although optional Lighter credentials and saved-Play order matching exist. Replace blanket wording with the current capability boundaries. Source: `frontend/src/features/workspace/ApplicationShell.tsx:294`.
- The empty-workspace steps require creating a portfolio first, although an account may remain Unassigned. Offer Add account directly, with optional portfolio creation. Source: `ApplicationShell.tsx:269`, S09.
- Give Overview's operation result and Review's saved-Play result an adjacent scope explanation and useful navigation between them. Different totals are not necessarily a bug. S05, S08.
- Saved evidence should not keep telling the owner it is only in the browser. Its view dialog currently uses that text regardless of saved state. Show unsaved/upload-pending/saved accurately. Source: `frontend/src/features/plays/EvidencePanel.tsx:131`, S07.

These are source-level product-copy findings. Rendered positioning, responsiveness, focus behavior and accessibility verification belong to the browser report.

## What should wait

- Another chart renderer, more default indicators, a global frontend cache or a message broker. Current chart work already addresses specific measured problems. Reuse it and measure before replacing it. S11.
- Replay, MAE/MFE and counterfactual exits until retained candle coverage and fill timing support honest answers. The owner's TimescaleDB direction still needs a plan; it is not shipped. S11; E1.
- More venues or Hyperliquid market breadth as a substitute for making existing imported records reviewable.
- AI coaching, social features, leaderboards and profit/plan-quality scores. They do not close the present workflow gaps and may conflict with the single-owner diary direction.
- Default beta/correlation heat, automatic emotion labels and fixed loss limits copied from the old proposal. Start with known exposure and owner-selected rules.

No layout redesign is needed for the first useful slices. Use the existing Summary, journal tabs, Execution, capital context, Plays list and Overview queue.

## Repository evidence index

Paths are relative to the repository root. Function/component names identify the inspected implementation. Historical introductory sections in architecture documents can be stale; later dated decisions and production code take precedence.

- S01: `frontend/src/features/plays/PlaysPage.tsx`, `PlayList`, save/status actions; `saved.ts`, serialization and dirty state; `PlayDialogs.tsx`, history and cancellation; `frontend/src/api/plays.ts`; `backend/src/Vessel.Api/PlayEndpoints.cs`; `backend/src/Vessel.Domain/Plays/Play.cs`, plan/status records. Contract: `docs/architecture/play-lifecycle.md`.
- S02: `frontend/src/features/plays/ExecutionPanel.tsx`; `usePlayExecution.ts`, initial check and visible-tab 60-second polling; `backend/src/Vessel.Api/PlayEndpoints.cs`, execution routes. Contract: order/fill linking state in `docs/architecture/play-lifecycle.md`. This review traced affordances, not matching correctness.
- S03: `frontend/src/features/plays/WorkspacePanels.tsx`, `CapitalContext` and `PositionSummary`; `PositionEditor.tsx`, clamp/size conversion/allocation; `EntryForm.tsx`, level units and estimates; `sizing.ts`; `planChecks.ts`; `PlanNotices.tsx`; `PlaysPage.tsx`, `planProblem`. Contract: October 3 to 5 sections of `docs/architecture/plays-workspace-contract.md`.
- S04: `frontend/src/features/plays/Suggestions.tsx`, `suggestions.ts`, `useSizing.ts`; `docs/architecture/sizing-suggestions.md`. Suggestions require Accept and do not route orders.
- S05: `frontend/src/features/review/ReviewPage.tsx`, definitions/filters/metrics/drill-down/coverage; `ReviewChart.tsx`; `frontend/src/api/review.ts`; `backend/src/Vessel.Application/Review/ReviewService.cs`; `backend/src/Vessel.Application/Plays/PlayOutcomeCalculator.cs`. Contract and method limits: `docs/architecture/portfolio-review.md`.
- S06: `frontend/src/features/workspace/ActivityOperations.tsx`, `OperationsTable.tsx`, `ActivityTable.tsx`, `activity-filters.ts`; `frontend/src/api/activity.ts`. The bounds and association meanings are specified in `docs/architecture/activity-operations.md`.
- S07: `frontend/src/features/plays/EvidencePanel.tsx`, `download` and saved-state wording; `saved.ts`, `draftEvidenceFromSaved`, `loadSavedPlay`, `syncEvidence`; `PlayChart.tsx`, `captureChart`. Contract: captures/evidence sections of `docs/architecture/chart-plan.md`. Images, note and markup persistence do not imply automatic market snapshots.
- S08: `frontend/src/features/workspace/OverviewSummary.tsx`, `OverviewScope.tsx`, `OverviewPlays.tsx`, `overview-scope.ts`, `ApplicationShell.tsx`; `frontend/src/api/overview-summary.ts`. Contract/state: October 13 sections of `docs/architecture/core-workspace-contract.md` and `core-workspace-state.md`.
- S09: `frontend/src/features/workspace/AccountsPanel.tsx`, `CreateDialogs.tsx`, `ManageDialogs.tsx`, `PortfolioAccounts.tsx`, `PortfolioDestination.tsx`, `usePortfolioDestination.ts`, `portfolio-icons.ts`; `ApplicationShell.tsx`, refresh coordination and in-memory view state. Contract/state: `docs/architecture/account-management-contract.md` and `account-management-state.md`.
- S10: `frontend/src/features/workspace/WalletAccountImport.tsx`, `AccountCredential.tsx`; `frontend/src/api/venues.ts`; `backend/src/Vessel.Infrastructure/Venues/Lighter/LighterReader.cs` and `LighterReader.Orders.cs`; `backend/src/Vessel.Infrastructure/Venues/Risex/RisexReader.cs`. Scope: `docs/architecture/lighter-delivery-contract.md`, `lighter-state.md`, `risex-integration.md`, `venue-registry.md`, `venue-instruments.md`.
- S11: `frontend/src/features/market/candleCache.ts`, `useCandles.ts`, `chartPreferences.ts`; `frontend/src/components/chart/frameEdit.ts`, `seriesWriter.ts`, `indicators.ts`, `IndicatorControls.tsx`; `docs/architecture/performance-plan.md` and `chart-plan.md`. Existing performance receipts are not new measurements from this review.
- S12: `frontend/src/features/settings/AppearanceSettings.tsx`, `appearance.ts`, `themes.ts`, `generator.ts`; `docs/architecture/appearance-settings.md`. Theme choices are browser preferences, not saved account settings.
- S13: `deploy/README.md`, especially publication, migrations, HTTPS, Backups and Isolated restore; `scripts/verify-release.py`. Packaging at this commit does not prove a public release was published.
- S14: `frontend/src/features/plays/WorkspacePanels.tsx`, `PlayJournal`; `frontend/src/features/workspace/OverviewPlays.tsx`, `matches`; `ApplicationShell.tsx`, disabled Strategies navigation; `docs/architecture/strategies-plan.md`, explicitly draft; `docs/design/strategy-alternatives.md`. Files under `prototype/strategies-*` are discovery material only.
- S15: `frontend/src/features/plays/PlayChart.tsx`, `ChartPanelProps`, planned overlays, `liquidationOverlay`, `LiveChart`; `frontend/src/components/chart/drawingTools.tsx`; `docs/architecture/chart-plan.md`, plan tools and live updates.
- S16: `frontend/src/components/notifications/NotificationProvider.tsx`, transient toast state; `frontend/src/features/plays/usePlayExecution.ts`; `docs/architecture/mvp-alignment.md`, monitoring/notifications direction; `docs/architecture/proposal.md`, proposals rather than a feature inventory.
- S17: `backend/src/Vessel.Infrastructure/Venues/Hyperliquid/HyperliquidPerpetualReader.cs`, `MaxFills`, `userFills` request and history notice; `HyperliquidPerpetualReader.MarketContext.cs`, funding rate; `docs/architecture/stablecoin-wallet.md`; `docs/architecture/portfolio-review.md`, funding and nominal-money limits.
- S18: `docs/project-brief.md`, `CONTEXT.md`, `docs/design/approved-baseline.md`, `AGENTS.md`. These establish the diary purpose, independent concepts, approved positions and current authorizations.

## Current external verification

Checked October 13, 2026. The URLs below are official docs, not live private account evidence. Web retrieval provided readable current pages; no venue credentials or order endpoints were used.

### E1. Hyperliquid fill and candle limits

Official URL: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint

The `userFills` section documents up to 2,000 recent fills. `userFillsByTime` documents up to 2,000 per response with only the most recent 10,000 available. `historicalOrders` documents up to 2,000 recent orders. Candle snapshot documents only the latest 5,000 candles.

Product consequence: fill backfill, order coverage and candle retention are different problems. Changing the fill endpoint alone does not provide unlimited history, complete order metadata or replay. These documented limits do not certify continuity for a particular account. The scope of a venue UI export remains unverified here.

### E2. Funding and non-funding ledgers

Official URL: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals

The user funding/non-funding section accepts `userFunding` or `userNonFundingLedgerUpdates`, account address and a start/end time range. Non-funding updates include deposits, transfers and withdrawals.

Product consequence: there is a documented source for these facts, but no implementation follows merely from showing a current funding rate. The page does not supply Vessel's concurrent-Play allocation policy or establish lifetime completeness. No specific fee tier, projected funding bill or trading-return claim is used in this review.

### E3. Cross and isolated liquidation

Official URLs:

- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations

Margining states that cross positions share collateral and that cross liquidation uses account value including unrealized P&L and maintenance requirements. Liquidations states that funding and other positions' unrealized P&L can change the displayed liquidation price. Isolated margin has a different collateral basis.

This supports correcting the tooltip, not calculating an owner's liquidation price from incomplete account data. The exact amount and direction of a particular account's change were not tested.

## Open decisions and uncertainties

- Retrospective record identity, manual execution editing and whether such records share the Play lifecycle need an approved contract.
- Structured review revisions and completion semantics remain unfinished. A saved free-text note should not silently become an adherence result.
- Fee/slippage assumptions, funding allocations, margin modes and cross-screen R methods need explicit definitions before additional numbers appear.
- RISEx funding inclusion remains unverified. Lighter's omitted unsupported/fee-bearing records remain a coverage limit, not an invitation to assume zero.
- Capture-time market snapshots and a durable candle archive remain separate from the implemented cache.
- No new usability, latency, venue completeness, production deployment or backend correctness claims were established by this static review.
- No preview server was started or replaced. The separate proposal on port 5190 is outside this review.

Changed path: `docs/product-review/2026-10-13-product-delta.md` only.
