# Vessel development roadmap

October 13, 2026. Priorities after the review of `7559248`. The owner has now
authorized P1 items 02–06 under VESSEL-44, with Sol implementation agents, two
independent adversarial Sol reviews, a PR and browser captures. The
[delivery contract](../architecture/diary-completion-contract.md) bounds that
work. Opus completed the six bug fixes and their concurrency follow-up under
VESSEL-43. P1 implementation and full integrated checks pass. Both independent
adversarial review tracks cleared the final fixes on October 14. See the
[delivery receipt and captures](verification/2026-10-13-p1.md).
P0/P1 below retain their original acceptance criteria. P2/P3 remain proposals.

**Verify and merge the completed diary workflow before expanding analysis.**
The branch now covers manual trades, eligible imported history, whole-position
estimates and structured review. The next proposed delivery is bounded history
coverage, paging and backfill, followed by opt-in tracking.

## Priority at a glance

| Priority | Develop | Completion gate |
| --- | --- | --- |
| P0, release blocker | The six confirmed bugs | Correct lifecycle/scoring, no save-time evidence loss, regression tests and independent verification |
| P1, must have for a complete diary | Actionable data-quality explanations, manual executions, retrospective review, whole-position money summary, structured review | A supported trade can be planned or honestly imported, recorded, understood and reviewed |
| P2, important next | Durable history ingestion, funding accounting, observed stop coverage and portfolio risk, retrieval/export, strategy versions | Reliable daily use, explicit coverage and usable comparisons without invented data |
| P3, nice to have | Weekly summaries, context snapshots, calendar, external notifications, historical analysis and optional AI assistance | Core records and the specific dependencies below are already reliable |

P2 is not permission to hide missing information. Cost exclusions, stale observations and unknown history must be visible in P1. Durable monitoring becomes a requirement before promising unattended tracking. Funding ingestion becomes a requirement before claiming funding-complete performance.

## P0 Fix and verify before expanding

### 01 Execution integrity and evidence saving

**Already in progress, not yet verified.** Finish R1–R6 from the [confirmed review](2026-10-13-review.md#six-confirmed-defects):

- Do not close a Play or score it for sizing while known order executions are missing.
- Reject exit executions that precede the entry. Preserve legitimate bracket orders placed early but filled after entry.
- Validate link roles against normalized side and position effect, including manual attribution.
- Reject terminal unlinking using fresh state under the existing lock. Do not add reopening.
- Prevent direction changes once entry executions exist.
- Preserve evidence notes, markup and removals made while saving. Keep unsaved edits visibly dirty.

Example: a filled entry order reports quantity 2, but retained entry executions total 1 and exits total 1. That is incomplete history, not proof of a completed trade.

Done when each defect has a regression test, valid partial/concurrent trades still work, `pnpm check` passes, isolated PostgreSQL tests pass and an independent review checks the saved-state races. No owner database is used.

**Existing records need a separate check.** Preventing new invalid transitions does not repair previously inconsistent Closed Plays. Identify affected records first. Preserve original facts and final-state policy; do not silently reopen, reassign or rewrite history.

## P1 Complete the core diary

### 02 Explain excluded, incomplete and stale records

Reuse Review coverage, the Execution tab and account refresh metadata.

- Let an exclusion count open the exact affected records and their reasons.
- Distinguish missing executions, incompatible links, incomplete fees, unsupported access and stale observations.
- Explain each result's scope: saved Plays, retained operations or account balances. Name the fee/funding basis and the reporting window.
- Offer only actions that actually exist, such as inspect executions or refresh supported data. Where a correction workflow is absent, say so.

Example: "Excluded: order A reports 2 executed; 1 retained. Inspect executions." Do not offer a button that invents the missing fill.

Done when a user can reach the affected record from a metric and understand why it was omitted. Unknown funding or missing history must not read as zero.

Depends on 01. A correction workflow for historical bad records needs its own small contract.

### 03 Record manual executions

Manual accounts already exist. Add the missing execution path inside the existing Play workspace, not a second trading application.

- Record opening and closing executions with source, timestamp, side, quantity, price, fee amount/currency and explicit unknown fields where allowed.
- Preserve edit/correction history. User-entered facts must remain distinguishable from venue-reported facts.
- Derive lifecycle and results from those facts using the same validated rules as imported executions.
- Support partial entries and exits. Reject contradictory quantities and unexplained over-exits.

Example: record a long entry of 1 unit at 100, then exits of 0.4 at 105 and 0.6 at 95. It remains Open after the first exit and becomes Closed after the second. The gross execution result is −1 before fees.

Done when this sequence survives reload, appears in Review with manual provenance and cannot be duplicated by retrying a request. A typed P&L or "Mark profitable" shortcut is not an execution record.

Depends on 01–02. First settle how manual facts and corrections fit the existing order-link model, including the treatment of terminal records.

### 04 Review imported history without inventing a plan

Add "Review this activity" to the existing operation drill-down.

- Show constituent executions and existing Play associations before the owner confirms attribution.
- Store an explicit retrospective origin and review timestamp. Agree the record/link model before implementation.
- Leave pre-trade thesis, initial stop and initial-risk R unavailable unless genuine contemporaneous evidence exists.
- Keep mixed, incomplete and already-linked activity visible. An operation can contain more than one Play; it is not automatically one strategy trade.

Example: the owner imports an old completed operation and writes "Entered too late." That is a later lesson, not the original thesis. Its execution result may be reportable while initial-risk R remains unavailable.

Done when eligible unassigned history can enter the review queue without modifying imported fill facts, double counting linked executions or assigning a whole net position to one concurrent Play.

Depends on 01–02 and an agreed source/attribution contract with 03. Manual execution delivery and retrospective delivery should be separate patches.

### 05 Finish the whole-position money summary

Extend the approved bottom Summary. Do not move the chart, journal, editor or capital context.

- Show all-stops planned loss, all-targets planned gain, aggregate reward-to-risk and risk share of a named reference.
- Reuse current quantity/price calculations. Reconcile totals with entry shares and split exits.
- Show priced quantity, stop coverage and target coverage separately from allocation totals.
- Label fee/slippage assumptions and exclusions. Do not claim a guaranteed maximum loss.
- Keep planned estimates distinct from realized results and the existing initial planned-risk estimate.

Example: two entries each contribute a planned loss of 0.5 quote units. Show total planned loss 1 before costs. If the second stop is absent, show known loss 0.5 plus an unknown-risk tranche, not total loss 0.5.

Done when long/short, multiple entries, split exits, leverage-linked percentages, missing levels and zero quantities have explicit tests. Partial plans must never look complete.

Depends on 01. Can proceed alongside 03–04 after deciding Draft-save versus Plan-it validation. Keep strict current behavior until the owner approves a change.

### 06 Finish the short structured review

Extend the existing Review tab and Needs review queue.

- Keep free text. Add optional adherence, a mistake tag, one lesson and one next action.
- Support Closed and Cancelled records; retrospective records can answer "not applicable" for pre-trade adherence.
- Preserve review amendments and timestamps without changing frozen plan revisions.
- Add a clear pending/reviewed filter and update the queue only after a successful save.

Example: a profitable trade that broke the stop rule remains profitable with a process violation. A loss that followed the plan remains a loss with adherence recorded.

Done when the queue handles planned and retrospective records, amendments preserve history, and missing answers are not treated as failure. Do not infer discipline from P&L or require an emotion score.

Depends on 01 and the origin contract in 04. The existing saved-Play review can be improved before all import UI is finished.

## P2 Make daily use reliable

### 07 Retain history and track without an open browser

Split this into three deliveries:

1. **Coverage and paging:** requested/retained ranges, limits, gaps and access state. Server queries must reach beyond Activity's current displayed cap.
2. **Bounded backfill:** venue-specific cursors, deduplication, retry and resume behavior. "All" always means all retained facts unless continuity is proved.
3. **Opt-in server tracking:** scheduled incremental reads, durable event records, last success/failure and visible stopped/stale state.

Example: importing older fills twice retains one copy and does not send fresh-fill notifications for old executions. A disabled account stops future work.

Done when tests cover restart, retry, cancellation, disabled accounts, exhausted venue windows and duplicate events. Monitoring must work with the browser closed before the UI advertises it.

Depends on 01–02. Specify scheduling and retention first; do not introduce a broker merely to run one bounded job.

### 08 Import funding and reconcile cashflows

Start at account/instrument level with separately retained execution fees, funding, deposits, withdrawals and adjustments.

- Preserve reported gross/net-of-fee basis and currency. Never deduct fees twice.
- Keep cash movements out of trading gains.
- Do not distribute funding across concurrent Plays without an explicit, visible allocation method.
- Version any accounting-method change. Do not silently alter the owner-approved sizing window or ladder.

Example: execution gross +120, fees 35 and separately reported funding cost 110 yield −25 for the covered scope. If funding coverage is unknown, show the execution-only result and the missing component instead.

Done when repeated ingestion is idempotent, venue totals reconcile for the declared period, and unknown/unsupported components stay explicit. Resolve RISEx funding treatment before making an all-in claim there.

Depends on 07's retention/coverage contract. P1 labels do not wait for this importer.

### 09 Show observed protection and known portfolio risk

Start with manual refresh, then connect to 07's durable monitor.

- Compare current attributed quantity with compatible observed working-stop quantity.
- Show last observation time and distinguish absent, ambiguous, stale and unsupported coverage.
- Sum known planned stop risk, with unknown-risk exposure beside it.
- Keep planned stops, imported fills and venue position references visually distinct.

Example: quantity 1 with compatible stops covering 0.6 leaves 0.4 uncovered. Three known risks of 150 on a 10,000 reference total 4.5%, with unmatched exposure still shown separately as unknown.

Done when concurrent Plays cannot claim the same order twice, position-level stops are not over-attributed and stale data never produces a confident protected state. A working order is an observation, not a promise of execution.

Depends on 01, 05 and explicit venue order semantics. Unattended alerts also depend on 07. Correlation models are not part of this first version.

### 10 Find, reuse and export saved work

Deliver small additions to existing screens:

- Plays search by title/instrument/account, useful sorting and a Needs review filter, with bounded server paging.
- Duplicate-to-Draft with new identities and no executions, outcome or completed review.
- One-Play portable export with notes, original images, markup, plan/revision provenance and coverage. Offer explicit redaction choices.

Example: duplicate last month's setup without carrying its entry fills or review into the new plan. Export the original for a mentor without leaking the wallet address or hidden notes.

Done when older records remain reachable, duplicates never affect source records, exports include evidence notes and redaction is tested against the actual exported bytes.

Depends on 01 and the record provenance settled in 03–04. Existing operator backup/restore stays in place; export does not replace it.

### 11 Add strategy versions and checklists

Refine the existing [strategy plan](../architecture/strategies-plan.md) before coding.

Start with a generic hypothesis, a few rules, an explanatory chart image and a frozen version reference on the Play. Keep strategy definition separate from observed behavior/results.

Example: changing a reclaim rule creates version 2. Trades planned with version 1 keep that rule set. Compare eligible outcomes with sample counts and missing coverage, not a declaration that one version has an edge.

Done when edits cannot rewrite historical strategy references, rules are not hard-coded to an asset, and checklist states support met/not met/not applicable.

Depends on trustworthy records and 06. This is valuable after the core diary works, not a reason to delay the integrity patch.

## P3 Nice to have after the foundations

| Feature | Small useful version | Prerequisite and boundary |
| --- | --- | --- |
| Weekly process review | Deterministic summary of outcomes, recurring mistake tags and next actions | 06; show sample counts, no AI needed |
| Context snapshots and tags | Timestamped, source-labelled context saved at planning/first fill | An agreed tag model and retention policy; never infer emotion or original intent |
| Calendar view | Daily outcomes and review status | Reuse current result calculations; retain scope and coverage |
| External notifications | One opt-in channel for durable events | 07; retries, deduplication, credential safety and visible delivery failures |
| Candle archive and MAE/MFE | A bounded archive, then excursion estimates over verified entry/exit intervals | 07 and a separate TimescaleDB plan; session cache is not history |
| Replay and counterfactual exits | One rule set on retained historical data | Valid execution intervals and archive coverage; same-candle order can remain unknown |
| Mobile quick capture | Convenient evidence/notes capture and visible save state | 01 and explicit offline/conflict semantics before promising offline use |
| Saved views and command palette | A few repeated navigation tasks | 10; add only where repeated use warrants it |
| Optional AI review help | Summarize selected existing notes with links to the source | 06, export/privacy controls and explicit opt-in; no invented thesis or autonomous trading |

More venues, indicator packs, theme expansion, social features, leaderboards, automatic trade grades and full backtesting should not displace P0–P2. Lighter, RISEx, themes, saved Plays, basic analytics and deployment/backup instructions already exist.

## UI work to ship with the relevant feature

Avoid a separate redesign project:

- **With 02:** correct categorical cross-margin copy, explain Overview versus Review scope, show accurate evidence save state and make Add account the first-use action with optional portfolio grouping.
- **With 05:** put total risk/reward in the existing Summary and label partial calculations where they appear.
- **With 06 and 10:** make pending reviews and relevant saved records easy to reach without losing edits.
- **Across these slices:** compact mobile context using disclosure within the approved stack, keep save state visible, and test keyboard focus, labels, contrast and 320/390 px layouts.

## Recommended delivery sequence

1. Finish and independently verify **01**. Inspect historical inconsistencies rather than declaring them repaired.
2. Ship **02**, then agree the small manual/retrospective contract and implement **03** and **04** separately.
3. Deliver **05** and **06**. Once contracts are settled, these can run beside the journal work in disjoint code areas.
4. Take **07** as the next infrastructure project. Small **10** retrieval/export improvements can ship without waiting for a complete monitor.
5. Build **08** and **09** on those facts. Then **11** has useful inputs for strategy comparisons.
6. Choose P3 features from actual usage, not as one large promised release.

**Current delivery:** P1 is authorized and in progress. Manual executions and
retrospective attribution follow the shared contract. The whole-position
summary is an independent implementation stream.

## Development gates

- Write a short contract before changes to execution origin, corrections, accounting, scheduling or strategy history.
- Use one bounded behavior change per patch, with regression tests, owner/account scoping, concurrency checks and retry behavior.
- Preserve exact decimal strings, normalized facts, native contract identities, unknown values and read-only venue access.
- Use synthetic test data and explicit isolated migrations. Never test against the owner's live database.
- Check rendered controls and the locked responsive layout for UI changes.
- Report what was tested, what remains unsupported and any manual migration/release steps. Passing tests is not a deployment.

No delivery dates are promised. The owner's subsequent request authorizes P1,
not the P2/P3 backlog.

## Evidence and governing contracts

- [Current review](2026-10-13-review.md), [backend defect reproductions](2026-10-13-backend-audit.md) and [product delta](2026-10-13-product-delta.md)
- [Play lifecycle](../architecture/play-lifecycle.md) and [normalized execution facts](../architecture/execution-facts.md)
- [Plays workspace](../architecture/plays-workspace-contract.md), [chart plan](../architecture/chart-plan.md) and [approved layout](../design/approved-baseline.md)
- [Activity operations](../architecture/activity-operations.md), [portfolio Review](../architecture/portfolio-review.md) and [sizing suggestions](../architecture/sizing-suggestions.md)
- [Performance direction](../architecture/performance-plan.md), [strategy plan](../architecture/strategies-plan.md) and [release/backup instructions](../../deploy/README.md)
