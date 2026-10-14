# Improvement roadmap

> Historical review of `a51c7f2`. For the current assessment at `7559248`, read the [October 13 review](2026-10-13-review.md) and [feature delta](2026-10-13-product-delta.md). Old missing-feature and bug claims are not current findings.

October 2, 2026. This turns the [trader review](trader-review.md) and the [UI/UX audit](ui-ux-audit.md) into ordered, buildable steps. It is a **proposal for the owner**, not an authorization. Each phase still needs the usual contract and approval before implementation, as recorded in `AGENTS.md`.

IDs refer to the source documents: **M/G/I/N** are in the trader review; **B** (bugs) and the section numbers (§) are in the UI audit.

## Principles every step must keep

- A price touch or candle is an **observation**, never a fill. Lifecycle changes come from confirmed fills or a manual action.
- Imported history never receives a fabricated thesis, stop or plan. Retrospective inputs are labelled.
- Concurrent Plays may share an account and instrument. Links use order or fill identity, never a guess.
- Read-only venue access. Vessel records and flags; it never blocks trading or places venue orders. In-app status gates (such as validation before *Planned*) are allowed.
- Unknown stays null, not zero. Exact decimal strings are preserved.
- The approved section order stays: capital above, chart left, journal below the chart, position right, summary last. Compressing heights is allowed; moving sections needs owner approval.

## Phase 0: quick wins (days, frontend only)

Small, low-risk fixes that make the current draft workspace trustworthy.

| # | Change | Source | Acceptance |
| --- | --- | --- | --- |
| 0.1 | Plan validation with inline messages and an issues badge | B1, §4.3 | Long with stop 90 above entry 87 shows "Stop 90 is above the Long entry 87" and badge "1 issue". Entry shares 50 + blank show "50% unassigned". |
| 0.2 | Warn above the catalogue `maxLeverage`; presets derived from it | B2, I1 | HYPE (max 10×) offers 1×, 3×, 5×, 10×; 25× stays, with inline "Above HYPE max 10×". Clamping is owner decision 9. |
| 0.3 | Allocation total treats blank as 0 and is only green at exactly 100% | B3, I4 | Adding entry 2 shows "50% allocated" in amber |
| 0.4 | Convert instead of clearing on price ↔ % switches (margin ↔ quantity conversion moves to 1.1, as it needs calculation) | I3, §4.4 | Stop 83.8 with entry 87, switched to %, shows 3.68%. Owner decision 8. |
| 0.5 | Offer "Mirror levels to Short?" when direction changes with levels set | §4.3 | Switching to Short with stop 83.8 and entry 87 offers stop 90.2 |
| 0.6 | Chart tags: stack or group collisions, one tag per price, entry colours away from red/green | B4, §4.2 | TP1s at 91/91.5/92 render "TP1 ×3 · 91–92"; E1 SL = E3 entry shows one tag "84.60 E1 SL · E3" |
| 0.7 | Compress the Plays header to two rows; ⓘ popovers for caveats; fold the sizing assistant into a one-line risk field; drop the "Layout locked" caption | §4.1, B10 | Chart top at about y≈260 at 1440×900; section order unchanged. Owner decision 7. |
| 0.8 | Overview: replace the stale card with "Plan a trade →"; lead with equity; fix the footer wording | B5, B6, §5 | No "Not enabled yet" text; footer "3 accounts · 1 venue-connected (read-only)" |
| 0.9 | Copy and labels: real unit names (USDC, HYPE), unclipped size select, account detail subtitle, post-refresh empty state, attribution link name | B7–B9, B11 | — |
| 0.10 | Draft autosave to session storage as a safety net until M1 ships (captures excluded or size-capped) | audit §8 #6 | Reload restores levels and journal text; banner "Restored unsaved draft from 14:05" |

0.10 is a stopgap. It conflicts with nothing in the evidence design because images stay in the browser either way, but it should be confirmed with the owner since the current contract says reload discards the draft.

## Phase 1: close the planning loop

### 1.1 Money summary and risk-first sizing (M2)

Frontend first: all inputs already exist in the draft and the instrument catalogue.

- **Inputs:** risk % of the risk reference (account value or explicit budget), margin mode (cross or isolated), maker/taker assumption per leg, assumed stop slippage (default from the venue's TP/SL behaviour, editable).
- **Outputs:** risk $ / % / R with fees, reward $ / R, blended R:R, quantity, notional, margin, margin %, isolated liquidation per fill path, max safe leverage, funding per day at the current rate.
- **Formulas** (long; mirrored for short):

  ```text
  avg            = Σ wᵢ·Eᵢ
  loss per unit  = Σ wᵢ·|Eᵢ − Sᵢ|
  qty            = riskBudget / (loss per unit + fees per unit)
  liq (isolated) = avg × (1 − 1/L) / (1 − mmr)          mmr from the margin table
  Lmax           = 1 / (1 − (S/E) × (1 − mmr))           evaluated on every fill path
  fee R          ≈ (entry fee % + exit fee %) / stop distance %
  ```

- **Acceptance**, using the trader-review example (10,000 USDC, BTC, E1 60,000 / E2 59,000, stop 58,000, TP 62,000 / 64,000):

  ```text
  Risk 1% → 0.0651 BTC (fees inside budget) · R:R 2.33 · 10× isolated liq ≈ 54,228
  Max safe isolated leverage 26× full / 22× worst path
  ```

  The HYPE example from the audit (25,000, entries 87 / 85.5, stop 83.8) gives 102.04 HYPE before fees, R:R 2.76.
- Every figure has an ⓘ listing its assumptions. Cross-margin liquidation shows "depends on account; shown once the position is open".
- The approved prototype's calculation contract and tests (`prototype/model.mjs`, `prototype/model.test.mjs`) are the starting point.

**Needs owner decision:** this replaces the "financial calculations deferred" rule in the Plays contract.

### 1.2 Play persistence, revisions and context snapshot (M1)

- **Backend:** extend the `Play` aggregate (title, direction, sizing, leverage, entries, stops, targets, journal fields, drawings, management rules), owner-scoped CRUD and list endpoints, and a `play_revisions` table (who, when, reason, diff).
- **Snapshot** at *Planned* and at first confirmed fill: plan JSON, a capture, and market context (candles around the plan time, mark, funding, OI, premium). Candles are stored because Hyperliquid keeps only the latest 5,000 per interval.
- **Evidence:** upload draft images on first save through the existing `/api/plays/{id}/evidence` routes.
- **Frontend:** a Plays list (title, instrument, direction, status, planned R:R, updated), open and edit, "Saved 14:05" state, unsaved-changes guard.
- **Acceptance:** create, reload, edit and archive a Play; revision 3 "widened stop" is visible with the before/after stop; evidence survives a reload.

### 1.3 Lifecycle (G4)

Idea → Planned → Active → Closed → Reviewed, plus Cancelled and Missed. Manual transitions now; Active and Closed later also from confirmed fills (Phase 2). Validation issues (0.1) block *Planned* but never block saving.

### 1.4 Management rules and invalidation (M4)

Structured fields on the Play: stop scope (position or per entry), after-TP1 rule, trailing rule, time stop, invalidation conditions (price close, time, funding). Stored with revisions so the review can check them.

## Phase 2: close the execution loop

### 2.1 Complete fill import

`userFillsByTime` paging with overlap and deduplication (the latest 10,000 fills), plus background incremental sync. Keep the documented limits visible: "complete back to 2026-07-14 (provider limit)".

### 2.2 Trades view and order-level links (M5)

- Derive round trips per account and instrument as a view. Group TWAP slices, split flips, flag liquidations, show builder fees separately.
- Link at **order or fill level** to a Play entry or exit. A round trip can show several Plays.
- **Unreviewed inbox** with: Link orders · No plan · Hedge · Impulsive · Retro review.
- **Acceptance:** two concurrent Plays on BTC with distinct order IDs show as one round trip containing both, each Play showing only its own fills.

### 2.3 Protection check (M6)

Read `frontendOpenOrders` for the account. Compare with active Plays: missing reduce-only stop, stop price differs from plan, stop covers less than the position. Show it on the Play, the account and Overview as observations.

### 2.4 Outcome in R (M7)

Planned R, initial R, realised R (after fees and funding), entry slippage, exit versus plan, sizing error. Acceptance uses the trader-review example: +$190.02 net → **+1.83R** (initial R $104.00, sizing error 1.04), slippage 0.04R, 0.37R not captured on the TP2 half.

## Phase 3: learn from it

| # | Step | Source | Notes |
| --- | --- | --- | --- |
| 3.1 | Structured one-minute review and the process/outcome grid | M8 | Adherence N/A for unplanned trades; mistake tags; emotion; lesson |
| 3.2 | Automatic context tags | G1 | Session, weekday, funding/OI at entry, volatility percentile, event window |
| 3.3 | Portfolio heat | M3 | Known plus unknown open risk; beta-adjusted figure labelled as an estimate |
| 3.4 | Soft guardrails and behaviour signals | M9 | Defaults editable in Settings; breaches recorded, never enforced |
| 3.5 | Setups, playbook and checklist | G2, G3 | Light start; versions when rules change |
| 3.6 | Analytics with n and ± SE | M10 | Expectancy, profit factor, R curve, drawdown, cost per tag, followed vs broken |
| 3.7 | Overview performance strip | I9 | "This week: 7 trades · +3.1R · adherence 86% · open risk 2.0% + 1 unknown" |

## Phase 4: deepen

Alerts on planned levels (G6), actual position on the chart (G7), MAE/MFE (G8), liquidity estimate (G9), templates (G10), search (G11), daily journal (G12), review cadence (G13), export (G14), CSV import (G15), then the nice-to-haves N1–N11.

## Decisions the owner needs to make

1. Allow labelled **estimates** for money figures, replacing "financial calculations deferred"? (Unblocks 1.1.)
2. Allow a **session-storage autosave** before full persistence? (0.10)
3. **Default margin mode** for planning: cross (the venue default) or isolated (the only mode a pre-trade liquidation estimate can describe)?
4. **R for unplanned imported trades:** dollars only, or a retrospective stop entered by the trader and labelled as such?
5. Start with **setups and a playbook** before full versioned strategies?
6. Which **soft limits** to ship as defaults (daily −2R, weekly −5R, 3 trades a day, 3% open risk)?
7. Approve compressing the Plays header (0.7) within the locked section order, including folding the optional sizing assistant into a risk field?
8. Allow deterministic price ↔ % conversion instead of clearing the value? (0.4)
9. Clamp leverage to the venue maximum, or only warn? (0.2)
10. Use the account's known value as the default available budget, keeping the override? (audit §8 #8)
11. Change the shared mobile stack to a segmented Chart · Position · Journal · Summary view? (audit §4.7)

## Suggested first slice

Phase 0 plus 1.1 is mostly frontend work on code that already exists, and it removes the biggest complaint: *"the app knows my numbers but won't do arithmetic."* Phase 1.2 is the next largest unlock, and every later phase depends on it.
