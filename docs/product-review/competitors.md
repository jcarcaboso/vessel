# Competitor benchmark: trading journals and planning tools

> Historical review of `a51c7f2`. For the current assessment at `7559248`, read the [October 13 review](2026-10-13-review.md) and [feature delta](2026-10-13-product-delta.md). Old missing-feature and bug claims are not current findings.

October 3, 2026. This compares Vessel with the leading trading journals, crypto and perps tools, and open-source self-hosted journals. It supports the [trader review](trader-review.md) and the [roadmap](roadmap.md). It is review material, not an authorization to build. IDs M1–M10, G1–G15, I1–I11 and N1–N11 refer to the trader review. New items found by this benchmark are numbered **X1–X9** in [section 5](#5-gaps-the-benchmark-exposes).

## 1. Method

- **Checked on:** October 3, 2026, through web search and direct fetches of official pricing, feature, help and documentation pages, plus GitHub READMEs and the GitHub API for open-source projects.
- **Source grading:** a claim taken from the vendor's own site or docs is treated as verified. A claim found only in third-party reviews is marked **(3p)**. Anything not found is marked **?**, which means "not found", not "absent". Vendors change plans often, so prices are as listed on the check date and exclude VAT.
- **Not done:** no tool was signed up for or used hands-on. Mobile apps, AI quality and import accuracy were not tested. TraderSync's site returned HTTP 403 to automated fetches, so its details come from third-party reviews.
- **Scope:** Vessel is a self-hosted, single-user, read-only planner and journal for crypto perpetuals, Hyperliquid first. Tools are judged against that job, not against general stock or futures day trading.

### Tools reviewed

| Tool | Type | Main sources |
| --- | --- | --- |
| Edgewonk | Journal, one plan | [pricing](https://edgewonk.com/pricing), [features](https://edgewonk.com/features), [import list](https://edgewonk.com/import), [psychology](https://edgewonk.com/trading-psychology) |
| TradeZella | Journal + AI + backtesting | [pricing](https://www.tradezella.com/pricing), [llms-full.txt product description](https://www.tradezella.com/llms-full.txt), [R-multiple help](https://help.tradezella.com/en/articles/7190710-understanding-r-multiple) |
| TraderSync | Journal + replay + AI | 3p only: [tradingtoolshub pricing guide](https://tradingtoolshub.com/blog/tradersync-pricing-guide-2026/), [daytradingtoolkit review](https://daytradingtoolkit.com/reviews/tradersync-review) |
| Tradervue | Journal, oldest of the group | [pricing](https://www.tradervue.com/site/pricing/), [risk reporting / R](https://www.tradervue.com/help/risk_reporting), [MFE/MAE calculations](https://help.tradervue.com/article/3440-mfe-and-mae-calculations) |
| TradesViz | Journal, deep analytics, Hyperliquid sync | [pricing](https://www.tradesviz.com/pricing/), [Hyperliquid sync](https://www.tradesviz.com/blog/auto-import-hyperliquid) (Apr 3, 2025), [broker page](https://www.tradesviz.com/brokers/Hyperliquid), [trade plans](https://tradesviz.com/blog/trading-plan-checklist) |
| CoinMarketMan (CMM) + HyperTracker | Crypto derivatives journal, Hyperliquid wallet tracker | [home](https://coinmarketman.com), [pricing](https://coinmarketman.com/pricing), HyperTracker (3p: [App Store listing](https://apps.apple.com/fr/app/hyperliquid-tracker-scan/id6755161258)) |
| TraderMake.Money (TMM) | Crypto futures journal | [home](https://tradermake.money) |
| TradingView Long/Short Position tool | Pre-trade drawing tool | [support article](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/) |
| Hyperdash, HypurrScan | Hyperliquid analytics and explorer | 3p: [pm.wiki comparison](https://pm.wiki/compare/hyperdash-vs-hypurrscan) |
| LuxAlgo Trade Journal | Open source (MIT), self-hosted, SQLite | [GitHub](https://github.com/LuxAlgo/trade-journal), [market-data doc](https://github.com/LuxAlgo/trade-journal/blob/HEAD/docs/market-data.md) (repo created Aug 2026, pushed Sep 30, 2026, ~400 stars) |
| TradeNote | Open source (GPL-3.0), self-hosted, MongoDB | [GitHub](https://github.com/Eleven-Trading/TradeNote) (~970 stars, last push Apr 2025) |
| Hyperliquid-specific hobby journals | Hyperjournal (hosted), HL Journal (self-hosted) | [Hyperjournal](https://journal.bennobananas.duckdns.org/), [dsacedo/hyperliquid-journal](https://github.com/dsacedo/hyperliquid-journal) |

Also looked at, with too little relevance or evidence for a column: **Kinfo** (verified-performance social journal; no crypto or perps support found, [NexusFi listing](https://nexusfi.com/d/journals/kinfo)), **Journalytix** (futures, NinjaTrader-centric, live news feed; $47/month per 3p [tradingtoolshub](https://tradingtoolshub.com/review/journalytix/)), **Insilico Terminal** (free Hyperliquid execution terminal with TWAP, chase and scale orders; an execution tool, not a journal, 3p [QuickNode](https://www.quicknode.com/builders-guide/tools/insilico-terminal-by-insilico-trading)), **Deltalytix** (open-source futures journal with AI, [GitHub](https://github.com/hugodemenez/deltalytix)), and **TILT** (a read-only Hyperliquid discipline dashboard on GitHub, early and hosted on Supabase, [GitHub](https://github.com/k4arsh-cmyk/TILT)).

## 2. Feature matrix

Legend: **Y** offered · **P** partial or limited · **N** not offered · **?** not found in sources · **(3p)** third-party source only.

### 2a. Mainstream journals

| Capability | Edgewonk | TradeZella | TraderSync (3p) | Tradervue | TradesViz |
| --- | --- | --- | --- | --- | --- |
| Pre-trade planning (entries, SL, TP) | P: setup checklists; stops/targets entered per trade | P: day-level "Game Plan" by AI agent; no per-trade level planner found | ? | P: initial risk entered per trade | P: custom "Trade Plans" attached to trades or days |
| Risk sizing | ? | ? | ? | N | ? |
| R-multiples | Y (3p) | Y, per strategy | Y | Y, only for trades with initial risk set | Y ("R-value") |
| MAE / MFE | Y | Y | Y | Y, position and price variants | Y, plus running PnL (Platinum) |
| Trade replay | ? | Y, tick-level, Pro+ | Y, all paid tiers; precision varies by tier | N | Y, simulators (Pro+) |
| Playbooks / setups | Y, strategy tracking | Y, "Strategies" with rules | Y, "strategy checkers" | P: tags | P: plans + tags |
| Checklists / rules | Y, per-setup checklists | Y, rule "Progress Tracker" | ? | N | Y, typed checklist fields and Rules |
| Mistake tags | Y | Y | Y | P: generic tags | P: generic tags |
| Psychology / emotion | Y, Tiltmeter, mental journal | Y, tagging + AI session review | ? | N | P: custom fields |
| Auto import of crypto perps fills | P: Bybit listed; Excel import for others | P: Bybit, Binance; no Hyperliquid found | P: Binance listed | ? | Y: Hyperliquid by public address, last 2,000 orders, daily sync |
| Funding / fees accounting | P: fees; funding ? | ? | ? | P: commissions and fees (Gold) | ? (Hyperliquid import does not say) |
| Analytics depth | High: edge finder, streaks, time-of-day, simulator | High: Zella Score, insights | High | Medium–high: exit, liquidity reports (Gold) | Very high: "600+ stats" (Platinum) |
| AI insights | ? (3p calls Edge Finder "AI") | Y, agents tag trades and write session reviews | Y, Cypher chat, metered | N | Y, AI coach, query, chat; REST API and hosted MCP |
| Alerts | N | N | N | N | N |
| Mobile | ? | Y (stated) | Y (3p) | ? | Y, iOS and Android |
| Self-hosting / privacy | N, cloud | N, cloud | N, cloud | N, cloud | N, cloud; read-only connections |
| Pricing (Oct 2026) | $197/year, one plan | $35/$59/$99 per month; −25% yearly | $29.95/$49.95/$79.95 per month (3p) | $29.95/$49.95 per month | Free (stocks only); €17.99/€25.99 per month |

### 2b. Crypto, perps and open-source tools, and Vessel

| Capability | CMM + HyperTracker | TMM | TradingView position tool | Hyperdash / HypurrScan | LuxAlgo Trade Journal (OSS) | HL hobby journals | **Vessel today** | **Vessel proposed** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pre-trade planning | N (manual journal) | N | P: one entry, one SL, one TP | N | P: stops/targets per trade | P: Hyperjournal "write your thesis before you're in" | **Y**: multi-entry, per-entry stop, partial TPs, chart; memory only | M1, M4, G4, G10 |
| Risk sizing | ? | P: "trading rules" | Y: account size, risk, leverage | N | P: fee/stop rules per symbol | N | N ("Deferred") | M2, M3, I2 |
| R-multiples | ? | ? | P: R:R of the drawing | N | Y | ? | N | M7, I2 |
| MAE / MFE | ? | ? | N | N | Y, **estimated**, null when coverage is missing | N | N | G8 (+X1) |
| Trade replay | N | N | P: bar replay (separate feature) | N | Y, candle replay | N | N | N2 |
| Playbooks / setups | ? | ? | N | N | Y | N | N (Strategies greyed out) | G2, G10 |
| Checklists / rules | ? | Y, rule violations flagged | N | N | P | P: plan-adherence star rating (HL Journal) | N | G3, M9 |
| Mistake tags | ? | ? | N | N | Y | P: free tags | N | M8, X2 |
| Psychology / emotion | ? | P: notes | N | N | P: daily journal, voice | P: 0–5 "Tiltmeter" (HL Journal) | N | M8, M9 |
| Crypto perps auto import | Y: Bybit, Binance, Bitget, HL and others | Y: Binance futures and others; HL not found | N | Y: any address, read-only (public chain data) | Y: read-only SDK incl. Hyperliquid, Binance, Bybit, OKX | Y: Hyperliquid by address | **Y**: Hyperliquid, manual refresh, latest 2,000 fills | M5, I10, N11, X5 |
| Funding / fees | ? | **Y**: "profit, fees, and funding" | N | Y: market funding analytics | P: fees; MAE excludes fees | ? | P: fees on fills; live funding *rate* in chart; funding payments not imported | M2, M5, M7, X3, X4 |
| Analytics depth | Medium | Medium | — | Market-level, not journal | High, documented formulas | Low–medium | None | M10, G1, G11, N1, N4, N6, X7 |
| AI insights | ? | Y: "AI coach" | N | N | Y: bring your own Anthropic/OpenAI key | Some repos | N | N5 (opt-in), X8 |
| Alerts | Y: PRO alerts; HyperTracker push for fills, position changes, liquidations (3p) | ? | Y: platform price alerts | ? | N | N | N | G6, M6, N3, X6 |
| Mobile | Y: app | ? | Y | Web | Web | Web | Responsive stack, not phone-tuned | N9 |
| Self-hosting / privacy | N, cloud | N, cloud | N, cloud | N, public data | **Y**: local SQLite, credentials encrypted at rest | HL Journal Y; Hyperjournal hosted | **Y**: self-hosted, single owner, token | G14, X8 |
| Pricing | Free basic; PRO $699.99/yr; "Unlocked" free via partner exchanges incl. HL | Free plan with 31 days of history | Included in TradingView plans | Free | Free, MIT | Free | Free, own server | — |

**What the matrix shows.** Nobody combines (a) a multi-entry pre-trade planner, (b) perps-native risk maths and (c) Hyperliquid import. The mainstream journals are review-first: they analyse imported trades well but treat the plan as a tag, a checklist or a day note. The crypto tools are import-first and light on review. TradingView is the only real per-trade planner, and it ignores fees, funding and liquidation. Vessel already leads on planning (multi-entry, per-entry stops, partial targets, live chart, evidence markup) and trails on everything after the fill.

## 3. Ideas worth borrowing

Each idea names what the competitor does (sourced above) and an adapted Vessel example that keeps Vessel's principles: a price touch is not a fill, imports never get a fabricated thesis, concurrent Plays are allowed, venue access is read-only, and unknown stays null.

**1. R only where risk is known (Tradervue).** Tradervue defines R as the initial risk entered on the trade, and its R reports include only trades with initial risk set. Vessel should do the same and say so, instead of guessing a stop:

```text
Results in R     31 of 47 trades have an initial R (16 imported without a stop: shown in $ only)
Expectancy       +0.41R ± 0.22 (n = 31)
```

Retrospective stops (M7) count only when the trader enters them, and are labelled "retrospective". Maps to M7, M10.

**2. MAE/MFE as labelled estimates with coverage rules (LuxAlgo; Tradervue).** LuxAlgo computes MAE/MFE from complete candles only, excludes candles that cross a fill, returns *no number* when coverage is missing, and says the result can understate the true excursion. Tradervue separates position MAE/MFE from price MAE/MFE. For Vessel, using the M1 context snapshot:

```text
MAE −0.62R · MFE +2.10R   (estimate from 1m candles, 3 of 960 bars missing; may understate)
Trade #52                  MAE/MFE unavailable: candles older than the venue's 5,000-bar limit, no snapshot stored
```

Maps to G8, with M1 snapshot as prerequisite.

**3. Cost of emotional state in money and R (Edgewonk Tiltmeter).** Edgewonk links mood, fatigue and rule adherence to outcomes and shows what tilted trades cost (3p description). Vessel's optional M8 emotional state plus M9 signals can produce the same, honestly sized:

```text
Tagged "Tilted"   9 trades   −0.71R/trade   vs Calm 34 trades +0.38R/trade   (greyed: n < 20)
```

Maps to M8, M9, M10.

**4. Logging passed trades (Edgewonk missed trades).** Edgewonk lets traders record trades they skipped and why. Vessel's G4 *Missed/Cancelled* states and G5 observations should accept a quick reason and keep the outcome as an observation, never a fill:

```text
Passed  ETH short "funding too negative"  · Observation: price reached TP1 level 31 bars later; stop not touched before (1m candles)
```

Maps to G4, G5.

**5. Counterfactual management review (Edgewonk Trade Management Optimizer; Tradervue exit analysis; TradeZella Zella Scale).** These tools ask "what if you had managed the trade differently?". Vessel can answer it for its own stated management rules, labelled hypothetical, from stored candles. New item **X1**.

**6. Deterministic auto-tagging rules (TradeZella Auto Trade Tagger).** TradeZella's AI applies plain-English tagging rules ("tag trades above 2R", "tag revenge trades") at import. Vessel can get most of the value without AI, with rules the trader can read and audit. New item **X2**.

**7. Morning plan versus the day's results (TradeZella Game Plan and Session Review).** TradeZella compares the morning plan with the day's trades, and its AI then writes the review ("You do not write your own review"). Vessel should borrow the comparison and not the ghost-writing:

```text
Today's plan: "Bias neutral; only range edges; max 3 trades"
Actual: 5 trades (2 over plan) · 3 at range edges, 2 mid-range (−1.4R together) · review: [write one line]
```

Maps to G12, G13. N5 already says AI must never write a thesis; the same applies to reviews.

**8. Typed, analysable checklists (TradesViz Trade Plans).** TradesViz plans combine checkboxes, categories, text and numeric fields, and every field can be pivoted against results with win %, PnL and R. G3 should use typed fields so later analysis needs no parsing:

```text
Setup "HTF range reclaim" checklist   ☑ 4h close inside range   ☐ volume > 20-bar avg   Funding at entry: 0.0031%/h (number)
Analysis: "volume > avg" checked 18 trades +0.55R · unchecked 11 trades −0.12R (greyed)
```

Maps to G3, G2, M10.

**9. Wallet-address import with scheduled sync (TradesViz, CMM, Hyperjournal).** All three read Hyperliquid by public address only. TradesViz syncs the last 2,000 orders on connect and once a day after that. Vessel already reads by address; it should add background sync (I10) and close the history gap that the 2,000-fill limit leaves. New item **X5**.

**10. Funding in the trade record (TMM).** TMM records "profit, fees, and funding" for futures trades. Vessel shows the live funding *rate* but does not import funding *payments*. Hyperliquid exposes a `userFunding` history endpoint ([docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)). New item **X3**.

**11. Account size, risk and leverage on the chart (TradingView position tool).** TradingView's tool takes account size, risk, lot size and leverage and returns quantity, but its documentation mentions no fees or liquidation. Vessel's I6 ("create entry from this drawing") should carry the account and risk budget into M2, which then adds what TradingView lacks:

```text
Drawing → Entry E1 60,000 · SL 58,000 · TP 64,000 · risk $100 → 0.0500 BTC · fees −$1.76 · liq ≈ 54,684 @10× isolated ✓ beyond stop
```

(0.05 BTC = $100 / $2,000 per BTC; E1-only liquidation at 10× is the trader review's figure.) Maps to I6, M2.

**12. Push alerts on wallet events (CMM HyperTracker).** HyperTracker sends push alerts for fills, position changes and liquidations (3p). Vessel's notification design (N3) should start with events it already observes. New item **X6** covers the missing liquidation-distance alert.

**13. Documented, versioned metric definitions (LuxAlgo).** LuxAlgo publishes its Edge Score as a versioned formula, unit-tests every metric, and lets the trader choose FIFO, LIFO or weighted-average matching. Vessel's review already defines R terms (M7). Make those definitions a page in the app and version them. New item **X7**.

**14. Bring-your-own AI and a read-only data API (TradesViz REST API and hosted MCP; LuxAlgo BYO keys).** Both let the trader point their own tools or model at their journal. For a self-hosted, single-user app, a read-only local API is a natural fit for N5. New item **X8**.

**15. Redacted review export (Tradervue sharing; LuxAlgo PDF/PNG review export; CMM verification pages).** Traders share reviews with mentors. Vessel is single-user, so this means an export, not a social feature. New item **X9**.

### Deliberately not borrowed

- **Backtesting and bar-replay practice** (TradeZella, TraderSync, TradesViz): a different product. N2 replay of *your own* trade with *your own* plan is enough.
- **Single "health" scores** (Zella Score, Edge Score): the trader review dropped a plan quality score for the same reasons (arbitrary weights; could read as advice). If a score ever comes back, it must follow X7.
- **Social, leaderboards, verified-PnL pages** (Kinfo, CMM): conflict with single-user scope and privacy.
- **Whale tracking and wallet cohorts** (HyperTracker, Hyperdash): market research, not journaling. It could feed G1 context tags later but is out of scope now.
- **AI that writes the review or the thesis** (TradeZella Session Review): breaks "never fabricate a thesis".
- **Prop-firm cost tracking** (TradeZella, LuxAlgo): not Vessel's audience.

## 4. Where Vessel can differentiate

1. **Plan first, with revisions.** Competitors attach plans to trades after the fact (Tradervue's initial risk, TradesViz plans) or at the day level (TradeZella Game Plan). None found keeps a versioned, multi-entry plan with a frozen context snapshot (M1). That makes "you widened your stop after entry in 4 of your last 20 trades" a fact rather than a self-report.
2. **Perps-native maths.** No benchmarked journal shows liquidation versus stop, per fill path, before the trade. TradingView's position tool has leverage but no fees, funding or liquidation. Vessel's M2 can show "max safe 22× (worst path: E1 only)", maker/taker per leg and funding in R. Only TMM records funding in results, and none found expresses fees or funding in R.
3. **Honest uncertainty.** The mainstream tools present 100–600 statistics without sample size. Only LuxAlgo comes close, by returning no number when MAE/MFE coverage is missing. Vessel's n, ± standard error, greying below 20 trades, null-not-zero and "observation, not fill" are a real position, provided they are applied consistently (X7).
4. **Concurrent Plays on one position.** Every journal reviewed treats a round trip as one trade with one setup or tag set. Vessel's linking per order or fill (M5) handles two theses inside one netted Hyperliquid position. No competitor was found that does this.
5. **Private where it matters.** Hyperliquid fills are public: HypurrScan, Hyperdash and HyperTracker show any address's activity. Hyperjournal makes the right point: "Fills are public; your reflections aren't." The private asset is the thesis, evidence and review. Vessel keeps them on the owner's server, with no vendor AI, and with optional object storage the owner controls. LuxAlgo is the only self-hosted peer with comparable polish, and it has no pre-trade planner or perps maths.
6. **Process over outcome, without a coach persona.** Vessel's 2×2 process/outcome grid (M8) and soft guardrails that record rather than block (M9) fit a trader who wants evidence, not motivation. Edgewonk is closest in spirit.
7. **One price: free.** Paid journals cost $197–$1,188 a year at full price (Edgewonk yearly to TradeZella Ultra monthly). For a self-hosted owner the trade-off is maintenance, not money. G14 export/backup is what makes that credible.

## 5. Gaps the benchmark exposes

These items are not covered, or are covered only implicitly, by M/G/I/N. Each respects the principles above and would still need an owner decision and a contract.

### X1. Counterfactual management review

Competitors offer exit and trade-management "what if" analysis (Edgewonk, Tradervue Gold, TradeZella). Vessel can run it **only against the trader's own written rules (M4) and planned levels**, from stored candles, labelled hypothetical, with ordering uncertainty shown:

```text
Trade #41 (realised +1.83R)
  If held to TP2 64,000 as planned:   +2.18R   (hypothetical; TP2 reached 5h after your exit, stop not touched first; fees and funding included)
  If stop moved to break-even at 1R:  +1.83R   (no change; price never returned to 59,596)
Last 20 trades: manual exits before plan  −4.1R vs plan  (n = 9, greyed)
```

When 1m candles cannot tell whether the stop or the target came first, the result is "ambiguous", never a guess. Depends on M1, M4, M7, G8.

### X2. User-defined auto-tagging rules

G1 lists fixed context tags. The benchmark shows traders want their *own* rules applied at import (TradeZella's Auto Tagger). Deterministic, readable rules work without AI:

```text
Rule "revenge"     opened ≤ 60 min after a loss ≥ 1R      → tag revenge (auto)
Rule "big-size"    initial R > 1.5 × planned R             → tag oversized (auto)
Rule "news"        event in holding window (G1 calendar)   → tag event
```

Auto tags stay distinct from the trader's own mistake tags. A tag never asserts intent. "revenge (auto)" means the timing pattern, and the trader can dismiss it.

### X3. Funding payment import and attribution

Today Vessel imports fills (with fees) but not funding payments. `userFunding` returns the account's funding history. M5 and M7 assume funding is known; this item makes it so:

```text
Trade #41 BTC long  funding −$0.79 (16 hourly payments, venue-reported)
```

With concurrent Plays in one position, venue funding belongs to the **position**. Splitting it across Plays by size is an allocation and must be labelled "allocated", or kept at trade level only. Before the import exists, funding stays null, not zero.

### X4. Cash flows separated from performance

Equity curves and drawdown in % are wrong if deposits, withdrawals and transfers count as gains or losses. Hyperliquid exposes them through `userNonFundingLedgerUpdates`. The benchmark tools that show account equity curves do not say how they handle cash flows (not found). Vessel should:

```text
Sep equity  10,000 → 12,400   = +2,000 deposit (not performance) + 400 trading result
```

R-based analytics are unaffected, but "% of account" risk (M2, M3) needs the right denominator. This also touches the stablecoin wallet rules, so the same no-double-counting caveats apply.

### X5. History backfill and visible coverage

TradesViz, like Vessel, starts from the most recent 2,000 records. Hyperliquid's `userFillsByTime` pages through time but serves only the **10,000 most recent fills** ([info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)). An active trader can lose older history for good unless Vessel stores it incrementally. Proposed: a backfill to the venue limit, background sync from then on (I10), and a coverage line on every analytics view:

```text
History: complete from 2026-06-14 (venue limit reached) · earlier trades: CSV import (G15) or unknown
```

Whether Hyperliquid's own UI export reaches further back was **not verified**.

### X6. Live liquidation-distance alert

M6 checks whether a stop exists and G6 alerts on planned levels, but nothing watches the open position against the **venue-reported** liquidation price. CMM HyperTracker alerts on liquidations after they happen. Vessel can warn before, as an observation:

```text
⚠ SOL long: mark 142.10 is 4.8% from venue liquidation 135.30 (your alert: 5%) · no reduce-only stop at the venue
```

Cross margin means another position can move the liquidation price. The alert uses the venue's `liquidationPx` and never estimates cross liquidation itself.

### X7. Methods page with versioned definitions

LuxAlgo publishes and versions its metric formulas. Vessel already has precise definitions in the review (planned, initial and realised R, scratch, sizing error, the fill-path liquidation formula, round-trip rules). Ship them as an in-app *Methods* page with a version on each computed figure, so a change in definition never silently rewrites history:

```text
Realised R  +1.83R   (method R-v1: net PnL after fees and funding / initial R)  [?]
Round trips: flat → position → flat per account and instrument; average-cost basis as reported by the venue
```

### X8. Read-only local data API for the owner's own tools

TradesViz offers a REST API and a hosted MCP server; LuxAlgo uses the owner's own AI key. For Vessel, a **read-only**, owner-token API (or a local MCP) over trades, Plays and reviews would let the owner use any model without Vessel shipping AI. It must exclude credentials and must never be able to write a thesis or review. Example query from the owner's own assistant: "list my last 20 trades tagged revenge with realised R". This is an owner decision because it widens the attack surface of a self-hosted service.

### X9. Redacted review export

G14 covers data export, not presentation. Traders share reviews with a mentor (Tradervue, LuxAlgo PDF/PNG). Proposed: a one-Play export with chart capture, plan, management rules, review and R outcome, with an option to **hide dollar amounts, account size and wallet address**:

```text
BTC long · Oct 2–3 · Planned 2.33R · Realised +1.83R · Followed plan: Partly (manual exit before TP2) · Lesson: "…"
```

### Smaller refinements found

- **Passed-trade reasons** on G4 *Missed/Cancelled*, as in idea 4 (Edgewonk).
- **Per-trade quality ratings** (entry, exit, management, 1–5) as optional M8 fields; the self-hosted HL Journal and Edgewonk use them. Keep them optional to avoid friction.
- **Position versus price excursion** in G8 (Tradervue): MFE in R for the position and in % for price, because scaled entries make them differ.

## 6. Summary for the roadmap

- The benchmark supports the review's order: the leaders win on what happens **after** the fill (R, MAE/MFE, tags, playbooks, analytics). Vessel cannot compete there until M1, M5 and M7 exist.
- Vessel's planning (multi-entry, per-entry stops, partial targets, evidence markup) is already ahead of every journal reviewed. Perps maths (M2) would make that lead clear, since no journal found shows liquidation versus stop.
- The most valuable new items are **X3 funding import**, **X5 history backfill and coverage**, and **X1 counterfactual management review**. X3 and X5 are data-integrity items: without them, R outcomes and analytics are either incomplete or lose history.
- Unverified: TraderSync details (site blocked fetches), HyperTracker features (third-party only), Edgewonk mobile and AI, funding handling in TradesViz and CMM, and how far back Hyperliquid's UI export reaches.
