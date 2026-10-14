# Vessel from a trader's seat: product review

> Historical review of `a51c7f2`. For the current assessment at `7559248`, read the [October 13 review](2026-10-13-review.md) and [feature delta](2026-10-13-product-delta.md). Old missing-feature and bug claims are not current findings.

October 2, 2026. The point of view is an experienced discretionary perpetuals trader whose goal is to **win more and lose less by improving process**. Findings are checked against the code on `main` (`a51c7f2`), not only the docs. Companion documents:

- [ui-ux-audit.md](ui-ux-audit.md): the hands-on interface audit with screenshots.
- [roadmap.md](roadmap.md): prioritised, buildable specs.
- [README.md](README.md): how the review was produced and what each round changed.

Money examples use a made-up 10,000 USDC Hyperliquid account. Fee rates are Hyperliquid's tier-0 rates at the time of writing (0.045% taker, 0.015% maker). Funding uses Hyperliquid's baseline rate (0.00125%/h, i.e. 0.01% per 8h, paid hourly on oracle-price notional). The venue's current schedule always governs. Formulas were recomputed by script. None of this is investment advice.

Every recommendation respects Vessel's principles: a price touch is not a fill; imported trades never get a fabricated thesis; concurrent Plays may share an account and instrument; venue access stays read-only.

## 1. Verdict

Vessel has the right philosophy and better foundations than most journals. It separates plan, fill, price observation and retrospective review. It refuses to fabricate a thesis for imported trades. It already has real candles, live data, drawing tools and evidence capture with markup.

But today a trader **cannot complete one loop** of *plan → execute → review → learn*:

- the Play cannot be saved;
- the money figures a trader needs before clicking buy show "Not calculated";
- imported fills cannot be grouped into trades or linked to a plan;
- nothing measures results in R.

Until that loop closes, Vessel is an excellent chart notebook, not a tool that improves a trader's edge. The fastest way to change that is in [section 3](#3-must-haves-in-order).

## 2. What exists today

| Area | State | Trader impact |
| --- | --- | --- |
| Plan a Play: entries, quantity shares, per-entry stop, partial targets, leverage, live chart, drag levels | Implemented, **memory only** | Strong planning UX; lost on reload |
| Journal: Thesis, Invalidation, Strategy, Evidence, Review | Five free-text boxes | Nothing can be analysed |
| Evidence: capture, upload, markup, notes | Browser only. Server storage exists, but no Play API can create the parent Play | Excellent once it can be saved |
| Money figures | Average entry only. Risk $, reward $, R:R, margin, notional, % of account show "Not calculated". Liquidation, fees and funding are absent | **A trade cannot be sized in the app** |
| Sizing assistant | Placeholder marked "Deferred" | The approved prototype had a working one |
| Hyperliquid import | Manual refresh, latest 2,000 fills, latest snapshot | Good raw material |
| Trades (round trips), PnL per trade, fill → Play links | Absent; every fill says "Unassigned" | Real results cannot be reviewed |
| Analytics, strategies, alerts, lifecycle | Absent; status is a fixed "Draft" badge | — |

Code references are in [appendix A](#appendix-a-evidence-in-code).

## 3. Must-haves, in order

The order follows dependencies and loss-reduction impact. M1–M5 close the loop. M6–M10 make the loop teach something.

### M1. Save Plays, with revisions and a frozen context snapshot

**Why.** Everything else depends on this. Today a browser refresh deletes the thesis, the levels, the drawings and the captures. A trader who loses one carefully written plan stops using the tool.

**What.**

- A Play API (create, list, get, update, archive) and a **Plays list** page.
- Each change to levels, size or management rules creates a **revision** with a time and an optional reason.
- At *Planned* and again at the first confirmed fill, freeze a **context snapshot**: the plan, a chart capture, and market context (recent candles, mark, funding, open interest, premium).

The snapshot matters because Hyperliquid serves only the **latest 5,000 candles per interval**: about 3.5 days of 1-minute data. MAE/MFE, replay and missed-trade review are impossible later unless the context is stored at the time.

**Example.**

```text
Plan v1  Oct 2 14:05  Planned   Stop 58,000  TP1 62,000  TP2 64,000
Rev 2    Oct 3 09:12  "TP1 filled, stop to break-even"   Stop 59,560 (+fees ≈ 59,596)
Rev 3    Oct 3 16:40  "widened stop"                     Stop 57,500  ⚠ risk increased after entry
```

The review can then state a fact instead of a feeling: "you widened your stop after entry in 4 of your last 20 trades."

### M2. Risk-first sizing and a complete money summary

**Why.** Professionals size from the stop: "if I'm wrong I lose $100; how big can I be?" Leverage only decides how much margin that uses. The approved prototype already had this math (`prototype/model.mjs:82-147`).

**What the summary must show for the entered position:**

- risk in $, % of account and R at all stops, **with fees per leg and an assumed stop slippage**;
- reward in $ and R at all targets, and blended R:R. Label it as assuming every entry and target fills;
- quantity, notional, margin and margin % of account;
- **margin mode** (cross or isolated);
- the estimated isolated liquidation price, and the **highest leverage that keeps liquidation beyond the stop on every fill path**.

The sizing assistant takes "risk 1% of account" and returns the quantity. It should size so that fees fit inside the budget too. (The examples below use the pre-fee 0.0667 BTC for readability.)

**Worked example.** Account 10,000 USDC, risk 1% = **$100**. Long BTC.

| Entry | Share | Price | Stop | TP1 (50%) | TP2 (50%) |
| --- | --- | --- | --- | --- | --- |
| E1 | 50% | 60,000 | 58,000 | 62,000 | 64,000 |
| E2 | 50% | 59,000 | 58,000 | 62,000 | 64,000 |

```text
Average entry           = 0.5 × 60,000 + 0.5 × 59,000           = 59,500
Loss per 1 BTC of size  = 0.5 × 2,000 + 0.5 × 1,000             = 1,500
Quantity                = 100 / 1,500                           = 0.0667 BTC
Notional                = 0.0667 × 59,500                       ≈ 3,967
Margin at 10×           ≈ 397 (3.97% of account)
Profit at all targets   = E1 0.0333 × 3,000 + E2 0.0333 × 4,000 ≈ 233  (each entry's own average target distance; if everything fills)
Planned R:R             = 233 / 100                             = 2.33
```

**Fees per leg.** E1 and E2 are resting limit orders, so they pay maker. A stop market order pays taker.

```text
Entry (maker 0.015%)   0.0667 × 59,500 × 0.00015 = $0.60
Stop  (taker 0.045%)   0.0667 × 58,000 × 0.00045 = $1.74
Total if stopped                                  = $2.34 = 0.023R
Fees-inclusive size    100 / (1,500 + 35 fee per BTC) ≈ 0.0651 BTC
```

A rule of thumb the UI can show: **fee cost in R ≈ (entry fee % + exit fee %) / stop distance %**. With both legs taker (0.09%) and a 0.45% stop, fees are 20% of R. With a 0.25% stop, 36%. That is how tight-stop scalping quietly loses.

**Funding.** At the baseline 0.00125%/h on $3,967, the position pays about **$1.19/day**. Over a 5-day hold that is $6 = 0.06R. At 5× the baseline for the whole hold, it is about $30 = **0.30R**. Longs pay when funding is positive and receive when it is negative. The chart already streams the hourly rate (`PlayChart.tsx:245`). Turn it into "estimated funding: −$1.19/day (0.012R)".

**Liquidation versus stop.** BTC's catalogue entry already returns `maxLeverage` 40×. The UI displays it but lets the slider reach 100× (`InstrumentPicker.tsx:59`, `PositionEditor.tsx:67`). For a freshly opened **isolated** long, with maintenance margin at half the initial margin of max leverage (mmr = 1/(2 × 40) = 1.25%):

```text
liq = avg × (1 − 1/L) / (1 − mmr)

Full position (avg 59,500)       E1 only fills (60,000)
10× → 54,228  ✓ 3,772 below stop  10× → 54,684 ✓
25× → 57,843  ✓                   25× → 58,329 ⚠ liquidated before the 58,000 stop
40× → 58,747  ⚠                   40× → 59,241 ⚠
```

The trap is the partial fill. At 25×, the full plan looks safe, but if only E1 fills, the position is liquidated before its stop. The isolated liquidation distance depends only on leverage, so the dangerous path is the one with the **widest stop distance**. Here that is E1 alone: 3.33%, against 2.52% from the average. The summary should say:

```text
Max isolated leverage with liquidation beyond the stop:
  26× if everything fills · 22× worst path (E1 only)
  where Lmax = 1 / (1 − (stop / entry) × (1 − mmr))  for a long
```

**Cross margin** is Hyperliquid's default. There, liquidation depends on total account value and every other position, so the planning estimate applies only to isolated mode. Once a position is open, show the venue's own `liquidationPx` from `clearinghouseState`, labelled as venue-reported. Larger positions move into higher margin tiers with a higher mmr, so the estimate must use the instrument's margin table.

**What the summary should say:**

```text
Risk    −$100.00 (1.00%) · fees −$2.34 · total −1.02R      Reward +$233 (2.33R, if all fill)
Size    0.0667 BTC · $3,967 notional · $397 margin @10× isolated (3.97%)
Liq.    ≈ 54,228 (estimate) ✓ beyond stop · max safe 22× (worst path)
Funding ≈ −$1.19/day at current rate
```

### M3. Portfolio heat across concurrent Plays

**Why.** Concurrent Plays are explicitly allowed. Three 1% plays on BTC, ETH and SOL are one large bet on crypto beta. Sizing a new Play without seeing open risk is the most common sizing error, and showing it is cheap.

**What.** Before a Play is marked *Planned*, show open risk across active Plays and venue positions. Positions with no known stop stay **unknown**, never zero.

```text
Open risk   2.2% known (BTC 1.0%, ETH 1.2%) + 1 SOL position with unknown stop
This Play   +1.0% → 3.2% known
Beta-adjusted, known only: BTC 1.0 + ETH 1.2 × β1.2 + this Play 1.0 ≈ 3.4% · SOL unknown
Your soft limit: 3%  ⚠
```

### M4. Trade management and invalidation as part of the plan

**Why.** Much of R is won or lost in management, not at the entry. If the rule isn't written down before the trade, the review cannot check it.

**What.**

- **Stop scope:** position stop or per-entry stops. Hyperliquid has position TP/SL (whole size) and order-attached TP/SL (fixed size). An order-attached TP/SL is cancelled if its parent order is cancelled after a partial fill. The plan should warn about that.
- **Management rules:** "After TP1 fills: stop to break-even plus fees. After 1.5R in favour: trail under the 1h swing low."
- **Time stop:** "If TP1 is not reached within 12h, exit."
- **Invalidation as conditions, not only a price:** "4h close below 58,500, or funding above 0.01%/h, or no reclaim by Friday 00:00 UTC."

Break-even must include fees. In the example, true break-even is about **59,536** with a maker entry and taker exit (59,500 × 1.00015 / 0.99955), not 59,500.

### M5. Fills → trades, linked per order or fill, with an Unreviewed inbox

**Why.** The venue is the truth about what happened. Today fills are a flat table where every row says "Unassigned". Most traders will import long before they plan in Vessel, so imports must be useful **without** a Play.

**What.**

1. Derive **trades** (round trips: flat → position → flat per account and instrument) as a *view*. Each shows entry VWAP, exit VWAP, size, gross PnL, fees, funding, net PnL and duration.
2. **Link Plays per order or fill (by order ID), never per round trip.** A round trip comes from the netted position, which can contain several concurrent Plays, and one Play can span several round trips.
   ```text
   Trade #41  BTC long  contains  Play A (oid 123, 0.04 BTC) + Play B (oid 456, 0.03 BTC)
   ```
3. Use what Hyperliquid fills already carry: a taker flag (`crossed`), `fee`, `builderFee`, `twapId`, direction including flips, and `startPosition`. Group TWAP slices into one execution. Split a flip ("Long > Short") into two trades. Flag liquidation fills. Show builder fees from third-party front-ends separately.
4. An **Unreviewed inbox** with explicit classifications. "No plan" is not the same as "impulsive":
   ```text
   Unreviewed (3)
   BTC  Long  0.0667 → flat  Oct 3 09:14–16:52  net −$104.10  [Link orders ▾] [No plan] [Hedge] [Impulsive] [Retro review]
   HYPE Short 120   → flat   Oct 3 11:02–11:40  net  +$38.20  [Link orders ▾] [No plan] [Hedge] [Impulsive] [Retro review]
   ```
5. Ambiguous facts stay unmatched until the trader decides. The app never guesses.
6. "Trade (round trip)" is a new term. Add it to `CONTEXT.md`, distinct from Play, Entry and Fill, before building it.

### M6. Protection check: is the open position actually protected?

**Why.** An open position with no stop at the venue is the largest source of tail losses. Venue open orders can be read with the same public address. No trading permission is needed.

**What.** Compare `frontendOpenOrders` (reduce-only and trigger orders) with the plan. Treat the comparison as an **observation**, not a fill:

```text
BTC long 0.0667   ⚠ No reduce-only stop at the venue
ETH long 1.2      ⚠ Venue stop 2,410 ≠ plan 2,450
SOL long 40       ⚠ Stop covers 50% of the position
```

Hyperliquid TP/SL market orders trigger on the **mark price** and fill with up to 10% slippage tolerance. The plan's assumed stop slippage should reflect that.

### M7. Outcome in R, with defined denominators

**Why.** Dollars hide skill. R makes trades comparable across size and instruments, but only if R is defined.

**Definitions.**

| Term | Meaning |
| --- | --- |
| Planned R | The risk budget in the plan ($100) |
| Initial R | Actual risk at first fill: actual fills against the planned stop |
| Realised R | Net PnL (after fees and funding) / initial R |
| Scratch | Realised result within ±0.1R |
| Sizing error | Initial R / planned R |

**Coherent example.** Same plan. E1 fills at 60,050 and E2 at 59,070 (average 59,560). TP1 (half) fills at 62,000 as a maker order. The trader closes the other half by hand at 62,900 (taker) instead of waiting for TP2 at 64,000. Held 16h at baseline funding.

```text
Gross PnL          0.0333 × (62,000 − 59,560) + 0.0333 × (62,900 − 59,560)  = $192.67
Fees               entry $0.60 + TP1 $0.31 + manual exit $0.94             =  −$1.85
Funding            16h at baseline                                          =  −$0.79
Net                                                                         = $190.02
Initial R          0.0667 × (59,560 − 58,000)                                = $104.00  (sizing error 1.04)
Realised R         190.02 / 104.00                                           = +1.83R
Entry slippage     0.0667 × (59,560 − 59,500)        = $4.00  = 0.04R
Exit vs plan       TP2 half: 0.0333 × (64,000 − 62,900) = $36.67 = 0.37R not captured
Planned R:R 2.33 · Realised +1.83R (= 1.90 × the $100 planned R)
```

That last line is not automatically a mistake: price may have reversed before TP2. That is why the review (M8) asks why.

Imported trades with no Play have no planned stop. Either the trader enters a stop after the fact, **labelled retrospective**, or the trade is analysed in dollars only. Never invent a stop.

### M8. A structured one-minute review: process separate from outcome

**Why.** This is Vessel's stated purpose. The current single "Review" textbox cannot deliver it. The prototype had adherence (yes/partly/no), outcome, what changed and the lesson (`prototype/app.mjs:335`).

**What.** Mostly clicks:

| Field | Input |
| --- | --- |
| Followed the plan? | Yes · Partly · No · **N/A (no pre-trade plan)** |
| Management rules followed? | Per rule from M4 |
| Mistakes | Multi-select: moved stop away, early exit, late entry, oversized, FOMO entry, revenge trade, no stop, added to a loser, ignored invalidation |
| Emotional state | Calm · Anxious · Euphoric · Tilted (optional) |
| Lesson | One line |

Then the 2×2 grid:

```text
                 Good outcome        Bad outcome
Good process     Earned win          Good loss — repeat it
Bad process      Lucky — dangerous   Deserved loss — fix it
```

Retrospective reviews of imported trades are labelled as such and never presented as pre-trade intent.

### M9. Soft guardrails and behaviour signals

**Why.** Rules set in advance hold better than willpower in the moment. Tilt shows up in timing and size before it shows up in notes. Vessel cannot place orders, so it **records and flags**; it never blocks.

**What.**

- Soft limits: daily −2R, weekly −5R, max 3 trades a day, max open risk 3%, drawdown from peak 10%.
- Behaviour signals from fills:

```text
⚠ Daily loss −2.1R passed your −2R limit at 15:42. New Plays will ask for a cooldown note.
⚠ After 2 consecutive losses you opened 3 trades in 40 min at 1.8× your median size.
  Trades opened within 1h of a loss: −0.6R/trade (n=14).
Sizing: initial/planned risk median 1.0, but 22% of trades above 1.5×.
  6 losses worse than −1.2R cost 4.1R more than planned.
```

### M10. Analytics, honest about sample size

**Why.** This answers "where is my edge, and where do I leak?"

**What.** All results in R, filterable by setup, instrument, direction, session, weekday, funding regime, event tag and mistake tag:

- trade count, win rate, average win and loss in R, **expectancy**, profit factor;
- R equity curve, max drawdown, longest losing streak;
- excess loss per mistake tag, compared with what the plan allowed;
- followed versus broken plans.

Show **n and ± standard error** on every figure, and grey out any figure with fewer than 20 trades.

```text
Expectancy = win% × avg win − loss% × avg loss = 0.40 × 2.5R − 0.60 × 1.0R = +0.40R/trade
Profit factor = 1.0 / 0.6 = 1.67

Followed plan   31 trades  +0.62R ± 0.31
Broke plan      12 trades  −0.48R ± 0.49   (greyed: n < 20; difference ≈ 1.9 SE, suggestive, not proven)

Tag "moved stop away"   6 trades   −9.5R vs −6.0R planned → 3.5R excess loss (greyed: n < 20)
```

The tags this needs come from M5 (classifications), M8 (mistakes) and the automatic context tags in G1. Build those before the analytics page.

## 4. Important next

| # | Feature | Why | Example |
| --- | --- | --- | --- |
| G1 | **Automatic context tags** | Free, and needed for M10 | Session (Asia/London/NY), weekday, funding and OI at entry, 24h range percentile, "event in holding window: FOMC Oct 29" |
| G2 | **Setups and a playbook** (a lighter start than versioned strategies) | Group results and compare new setups with the best past examples | Setup "HTF range reclaim": rules, checklist, default risk %, 3–5 A+ captures shown beside the new Play. Add versioning when a setup's rules are edited. |
| G3 | **Pre-trade checklist** per setup, with skips recorded rather than blocked | Later: "all criteria met +0.7R, skipped one −0.2R" | ☑ 4h close inside range ☑ funding \|f\| < 0.01%/h ☐ volume above the 20-bar average |
| G4 | **Lifecycle** Idea → Planned → Active → Closed → Reviewed, plus Cancelled and Missed | Missed and cancelled setups test whether the filter works | Active and Closed come from confirmed fills or a manual action, **never from a price touch** |
| G5 | **Missed-setup observations** | Whether skipping was right | "Price reached the TP1 level within 24 bars (observation; ordering against the stop unknown in 3 cases)" |
| G6 | **Price alerts** on planned levels (in-page first) | Plans are useless if the entry is missed | "BTC 0.4% from E2 59,000", an observation and never a fill |
| G7 | **Actual position on the chart** | Compare plan with reality at a glance | Fill markers, the venue's average entry and its liquidation line next to the planned levels |
| G8 | **MAE / MFE** from stored context | Shows whether stops are too tight or targets too greedy | "Median MAE on winners 0.6R; median MFE on losers 0.9R, so consider a partial exit at 0.8R" |
| G9 | **Liquidity and slippage estimate** versus order size | On thin markets slippage beats fees | "$40k market order: estimated impact 0.4% = 0.3R" (from `impactPxs` / order book). Warn above 10% of R. |
| G10 | **Duplicate Play, templates** | Repeated setups need speed | "New from setup" fills in the checklist, risk % and target structure |
| G11 | **Search, filter, saved views** | What can't be found can't be learned from | `setup:"range reclaim" tag:fomo R<0` |
| G12 | **Daily journal** not tied to a trade | Bias and plan for the day, end-of-day close | "Bias neutral; only range edges today" |
| G13 | **Review cadence** prompts | Reviewing needs a schedule | Daily 5 minutes: empty the inbox. Weekly: top leak, one rule to change. Monthly: keep, retire or revise a setup. |
| G14 | **Export and backup** (trades CSV; Plays and evidence as JSON plus files) | Self-hosted data must be portable | — |
| G15 | **Manual trade entry and CSV import** for manual venues | Quantfury and others have no integration | Upload a CSV and map its columns |

## 5. Improvements to what already exists

| # | Current | Problem | Improve to |
| --- | --- | --- | --- |
| I1 | Leverage 1–100× everywhere | Allows impossible settings (BTC max 40×) | Warn inline above the catalogue `maxLeverage` ("Above BTC max 40×") and show the safe maximum from M2. Clamping would change the current contract, so it is an owner decision |
| I2 | Stop/target % means distance from entry | Traders also think in R and ROE | Show all of them, and say which R: `58,000 · −3.33% · −0.67R play / −1.00R entry · ROE −33% @10×` |
| I3 | Switching price ↔ % clears the value (a deliberate contract rule today) | Throws work away | Convert using the entry price; it is a deterministic conversion. Owner decision |
| I4 | Shares need not total 100% | Silent invalid plans | A red total. Block *Planned* until entry shares and each entry's target shares total 100% |
| I5 | Fixed "Draft" badge | Looks like a control, does nothing | Hide it until the lifecycle exists, then make it the lifecycle control |
| I6 | Chart "position" drawing shows its own R | Can disagree with the plan | Offer "Create entry from this drawing" |
| I7 | Five free-text journal tabs | Nothing analysable | Keep the free text and add the structured fields (M4, M8, G3) |
| I8 | Activity: flat fill list, 100 rows | Unreadable after one active day | Trades by default (M5), fills on drill-down, filters and paging |
| I9 | Overview: balances and counts | Says nothing about performance | "This week: 7 trades · +3.1R · adherence 86% · open risk 2.0% known + 1 unknown" |
| I10 | Manual account refresh | Fills arrive late, reviews lag | Background sync (already planned) plus a "new fills" toast that opens the inbox |
| I11 | Evidence download includes markup, not the note | The note is the context | Option to put the note under the image, as the prototype did |

## 6. Nice to have

| # | Idea | Note |
| --- | --- | --- |
| N1 | **Risk-of-ruin and streak simulation** on your own R distribution | At a 40% win rate, a run of 10+ losses somewhere in 200 trades has about **38%** probability. Size so that run costs at most ~10–15%. |
| N2 | **Trade replay** with the plan's levels | Needs the stored context from M1 |
| N3 | **Telegram / Discord** notifications | Already anticipated by the notification design |
| N4 | **Generated weekly review** page | Best/worst trade, most expensive mistake, one rule to change |
| N5 | **AI review assistant** over your own journal | Opt-in or local only; must never write a thesis |
| N6 | **Calendar heatmap** of daily R | — |
| N7 | **Lighter** integration | Already planned |
| N8 | **Configurable themes** | Already accepted |
| N9 | **Mobile quick capture** into a Play | Phone screenshot plus one line |
| N10 | **Command palette and shortcuts** | `N` new Play, `L`/`S` direction, `E` add entry, `C` capture |
| N11 | **Hyperliquid breadth**: HIP-3 dexes (dex-qualified IDs such as `xyz:TSLA`), sub-accounts and vaults as separate accounts, portfolio-margin awareness | Margin mode and fees can vary per HIP-3 market; read them per market rather than assuming |

**Dropped after review:** a 0–100 "plan quality score" (arbitrary penalties; could read as a recommendation) and a separate correlation matrix (covered by beta-adjusted heat in M3).

## 7. Risks to the concept

- **Friction kills journals.** If logging a trade takes more than about a minute, it stops happening. Default to clicks and tags, fill from imports, keep free text optional.
- **Over-cautious wording.** "Not calculated" everywhere reads as "this tool cannot help me". Show estimates, labelled as estimates, with their assumptions one click away.
- **Learning from noise.** Small samples look like insights. Always show n and uncertainty.
- **Reviews without numbers become a diary of feelings.** The R outcome (M7) must sit next to every review.

## Appendix A: evidence in code

| Claim | Location |
| --- | --- |
| Draft held in React state only; "Reloading … discards" | `frontend/src/features/workspace/ApplicationShell.tsx:49`, `frontend/src/features/plays/PlayWorkspace.tsx:85` |
| Backend `Play` has only account, contract and status | `backend/src/Vessel.Domain/Plays/Play.cs:9` |
| No Play CRUD endpoints; evidence endpoints only | `backend/src/Vessel.Api/EvidenceEndpoints.cs:15-17` |
| Money figures "Not calculated"; assistant "Deferred" | `frontend/src/features/plays/WorkspacePanels.tsx:86-97,157-159` |
| Max leverage displayed but not enforced | `frontend/src/features/plays/InstrumentPicker.tsx:59`, `frontend/src/features/plays/PositionEditor.tsx:67,117` |
| Unit switch clears the value | `frontend/src/features/plays/EntryForm.tsx:47,67` |
| Fill `PlayId` defaults to null; Activity says "Unassigned" | `backend/src/Vessel.Application/Workspace/Contracts.cs:35`, `frontend/src/features/workspace/ActivityTable.tsx:12` |
| Strategies greyed out under "Later" | `frontend/src/features/workspace/ApplicationShell.tsx:159` |
| Funding rate streamed in the chart header | `frontend/src/features/plays/PlayChart.tsx:245` |
| Prototype sizing, payoff and warnings | `prototype/model.mjs:53-147`, `prototype/app.mjs:211-218` |
| Prototype structured review | `prototype/app.mjs:335` |

## Appendix B: sources

- [Hyperliquid fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Hyperliquid funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [Hyperliquid liquidations](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations)
- [Hyperliquid TP/SL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl)
- [Hyperliquid info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [HIP-3 builder-deployed perpetuals](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)
