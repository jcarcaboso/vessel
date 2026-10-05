# Strategies page: alternative concepts

October 4, 2026. Disposable discovery. No strategy feature, layout or data model has been approved. This follows the five-layout study in the `strategy-layout-prototype` worktree (`prototype/strategies.html`, `docs/design/strategy-prototype.md`, uncommitted there).

## Evaluation of the five-layout study

Keep: frozen versions with reasons, outcome kept separate from process, "subjective confidence, not probability", counterexamples as evidence.

Problems:

- The five layouts reorder the same eight panels for one strategy. There is no library or index, and no strategy lifecycle (idea, testing, shelved, retired). A 1–5 confidence slider stands in for those decisions.
- Review records are entered by hand on the strategy, in parallel to Plays. In the domain model, evidence comes from Plays that reference a strategy version (Play → strategy version → strategy).
- Ticking the checklist at strategy level is a rehearsal with no meaning. Condition checks belong to a Play, and adherence is recorded once per review rather than per rule.
- Cancelled and missed plays, which are review material, are not counted as evidence. No stop rule ("I'd stop using it if…") and no scope (instruments, timeframe, direction).
- Unclear what a Play points at while a working copy sits beside versions. The guided builder implies validation gates.
- Mint palette rather than the approved Graphite shell. The schematic chart scratchpad duplicates existing chart capture and evidence.

## New concepts

Both files are self-contained, use Graphite tokens and labelled sample data, and keep everything in browser memory. Serve only the prototype directory, e.g. `python3 -m http.server 5181 --bind 127.0.0.1 --directory prototype`.

`prototype/strategies-concepts.html` (one shared state; edits in D appear in A–C):

- **A · Library.** Strategy index with state filters and a per-play strip, plus a detail view. The detail shows current rules, an outcome × process matrix (process derived from rule checks; cells clickable) with a small-sample caveat, the plays table and a version timeline.
- **B · Rulebook.** The strategy as a versioned document. Rule-level diff against the previous version (added, removed, reworded), reasons on the version rail, plays pinned per version. Only the working copy is editable, and creating a revision requires a reason.
- **C · Rule ledger.** Plays × rules for one version (met, broken, n/a, unchecked) with "broken in n/N" per rule. It answers "do I follow my strategy?" and shows which rule to revise.
- **D · Inside a play.** The Play journal's Strategy tab: pick a version and answer each rule for this play. A newer version is shown but not applied automatically. Planning with an unmet rule is allowed and visible.

`prototype/strategies-agent.html` (delegated agent):

- **1 · Hypothesis board.** Idea → Testing → Shelved → Retired. Each move needs a reason, and Testing requires a frozen v1. "Shelved" avoids a clash with the Play status "Paused".
- **2 · Research log.** The strategy starts as a question with written predictions and a stop rule. One timeline gathers plays, untaken plays, version freezes, notes and stage moves, with setup/counterexample pairs pinned from Play evidence.
- **3 · Inside the Play.** Like D, plus asking why when a condition is unmet, locking the version after planning (changing it is a plan revision), per-condition adherence in Review, and retrospective labelling for imported plays.

## Recommendation

1. Start with the per-play condition check (D / agent 3). Every other view reads that data; without it any adherence or outcome × process view is invented.
2. Use the Library (A) as the page, with a stage field (Idea/Testing/Shelved/Retired, with a reason) rather than a separate board.
3. In A's detail, combine the Rulebook diff (B) with the research log's predictions, stop rule and timeline (agent 2). Offer the rule ledger (C) as a tab once a version has a few plays.

Open questions for the owner: whether Play condition checks are required or optional; whether "unsure" is a valid answer; whether strategies record scope (instruments, timeframe, direction) and whether the picker filters by it.

## Verification

Headless Chromium (Playwright, using libraries already extracted in `/tmp`; nothing installed): all views at 1440 and 390 px have no page-level horizontal overflow and no JavaScript errors. Scripted checks passed for: matrix filtering, the ledger cell cycle feeding the library matrix, revision creation with a diff, the D checks producing a deviation, and new strategy creation. The agent separately checked its file at 1440, 1100, 768 and 390 px, including text-escaping. Screenshots were reviewed. T3's preview browser was unavailable. Touch and drag interactions and contrast were not audited.

## October 5: definition and behaviour as two concepts

The owner pointed out that the concepts above mix two jobs: **creating a strategy** (the rules, when it applies, everything that defines it) and **seeing how it behaved** once Plays used it. The second round separates them. All three pages share `prototype/strategies-shape.css` and the sample state in `prototype/strategies-shape-data.mjs` (strategies with thesis when/expect/because, scope, rules typed as context/trigger/entry/risk/exit/avoid with must/nice-to-have, invalidation, review plan with predictions and a stop rule, pinned examples, versions; plays with per-rule checks and R results).

- `prototype/strategies-create.html`: ideas for creating and editing a definition (delegated agent).
- `prototype/strategies-review.html`: ideas for presenting behaviour (delegated agent).
- `prototype/strategies-flow.html`: the proposed combined shape.

### Proposed shape (`strategies-flow.html`)

1. **Library.** Strategies grouped by owner-set stage (Idea, Testing, In use, Shelved, Retired), each row with the one-sentence thesis, scope chips, the version Plays use, and a strip of its plays (rule broken, missed or cancelled, in progress are visible in the strip).
2. **Strategy page with three tabs.** *Definition* shows the frozen version only: when it applies, rules grouped by kind, when it is wrong, the review plan, pinned examples and a preview of the checklist a Play will show. No results. *Behaviour* is read from Plays: counts (missed and cancelled included), every play in time order as R bars with version boundaries and hollow bars for broken rules, outcome × process, which rules get broken, the review plan with the owner's own judgement of each prediction, and the plays list with pinning. *History* lists versions, their reasons and rule diffs.
3. **Create** is a guided builder (idea → when it applies → rules → wrong & review → save) with a live preview. It ends either as an Idea (name only) or by freezing v1, which needs a thesis, one trigger or entry rule, an invalidation and a reason.
4. **Edit** is a definition sheet over a working copy, with changes since the current version listed live. Freezing the next version requires a reason. Stage changes are separate from versions and also require a reason.

### Idea pages

Creation (`strategies-create.html`): guided builder with templates that hold questions, not rules; a playbook sheet with a working copy, a live diff and a required reason for each freeze; "from a real example", which turns answers about a past Play into candidate rules pinned to a schematic chart; and a pre-flight test, which dry-runs rules against past plays with outcomes hidden to find vague rules.

Behaviour (`strategies-review.html`): a scorecard; an evidence journal, a diary of plays and version freezes with pinning; rule diagnostics, which frames questions to look at (met vs broken plays side by side, never rates) and includes a plays × rules ledger; and a version comparison, labelled as not an A/B test.

The flow page takes the builder and sheet from creation and the scorecard, journal list and adherence summary from behaviour. Good candidates to add later: "from a real example" as a builder starting point, pre-flight before freezing a new version, and the full diagnostics and comparison as extra Behaviour views.

Chart marks use `--pos-mark #20a090` and `--neg-mark #d96a4a`. Both pass the dataviz palette validator against the dark card for lightness, chroma, colour-blind separation, normal-vision separation and contrast. `--flat-mark` is a neutral grey midpoint. The earlier muted green and red pair failed the colour-blind check. Sign is also carried by bar direction, hollow or filled shape, tooltips and tables.

## October 5: generic strategies and pictures

Owner feedback: strategies should not be tied to concrete assets, because the goal is to find generic strategies. Pictures drawn on charts should explain the idea, and they may come from one asset or several, with Hyperliquid as the default source.

- **Scope.** A strategy no longer lists instruments. "When it applies" says which markets fit in words (e.g. "Any liquid perpetual that has been ranging for days"), plus direction, timeframes, regime and sessions. The asset belongs to each Play. Behaviour lists the Plays' assets only descriptively.
- **Pictures.** These are illustrations on the strategy, made in a capture studio (`prototype/strategies-capture.mjs`). By default it loads a Hyperliquid chart for any listed perpetual (BTC first; 15m/1h/4h/1d; scroll back through about 300 candles) from the public info API. Alternatively it accepts an uploaded image. Tools: trend line, horizontal line, zone, long/short position, arrow, text, pen, eraser, and a rule marker. Each picture has a type (example, counterexample, explains rules), a caption and the rules it shows. The source is burned into the image (asset, interval, dates, or "uploaded" / "synthetic sample").
- **Rule pins.** Rules are numbered in the order a Play shows them (grouped by kind). A rule marker carries that number. Hovering a rule on the Definition tab highlights its pin, and "n pictures" jumps to a picture that shows it.
- **Where pictures appear:** a viewer at the top of the Definition tab, a thumbnail in the library, a Pictures step in the builder (duplicating a strategy copies its pictures and remaps the pins), and a Pictures section on the edit sheet.
- **Versioning.** Pictures are not part of a version: adding or editing one does not create a revision. Each records the version it was drawn for.
- **Sample pictures** use synthetic candles labelled on the image. The studio's Hyperliquid data is live. If Hyperliquid can't be reached it falls back to synthetic candles and says so.

For production, the studio should reuse the existing Lightweight Charts adapter, drawing model (time/price anchors), markup editor and `IEvidenceObjectStore` rather than this canvas, with candles from the backend candle endpoint instead of the browser calling Hyperliquid directly. Rule markers would be a new drawing kind. Strategy pictures need their own owner-scoped evidence association, because current evidence belongs to saved Plays.

Verified in headless Chromium at 1440 and 390 px, against live Hyperliquid:
- loading BTC, then ETH 1h, and moving back in time;
- drawing a zone, trend line, rule marker (which ticks its rule), text, long/short position and horizontal line, plus the eraser and undo;
- the required caption;
- saving, with a caption containing HTML shown as text;
- uploading an image in the edit sheet and drawing on it;
- a duplicated strategy keeping its pictures in the builder;
- rule hover changing and restoring the viewer;
- the earlier flow checks.

There was no page overflow and there were no errors. Touch drawing has not been tried on a real device.

The development plan that follows from this discovery is [strategies-plan.md](../architecture/strategies-plan.md).
