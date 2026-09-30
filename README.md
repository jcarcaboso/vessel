# Vessel

A trading diary for recording decisions, executions, and reflection.

This repository preserves the approved Graphite play-workspace baseline and its disposable browser prototype. No production stack has been selected.

- [Project brief](docs/project-brief.md)
- [Working glossary](CONTEXT.md)
- [Original sketches](docs/references/)
- [First visual direction](docs/design/concept-01.md)
- [Approved baseline and implementation handoff](docs/design/approved-baseline.md)
- [Prototype scope and LAN operation](docs/prototype.md)

## View the prototype

On the current server's LAN: **http://10.1.0.219:5173/**

Compare all ten dark designs: **http://10.1.0.219:5173/designs.html**

Graphite is the default, including when an old design-study preference exists. Direct variants use `/?theme=graphite`, `carbon`, `midnight`, `slate`, `forest`, `petrol`, `olive`, `espresso`, `aubergine`, or `stone`. The Design dropdown switches skins without resetting unsaved play data. Configurable themes are an accepted future capability.

The side-by-side layout is locked. The journal and bounded scrolling editor finish together above the summary. The gallery images preserve the earlier visual studies; open the live workspace for the approved geometry.

To run on another machine, from the repository root:

```sh
python3 -m http.server 5173 --bind 127.0.0.1 --directory prototype
```

Open `http://localhost:5173/`. No installation or build step is needed. HTML, CSS, JavaScript, an SVG chart, and a bundled font are prototype tools, not a production stack decision.

## What to try

- Compare the ten dark skins on the same locked side-by-side layout.
- Define entries and partial targets using absolute prices or entry-relative percentages.
- Set one full-position margin or quantity, then give each entry a percentage of that total quantity.
- Adjust leverage with the linked slider and numeric input, from 1× to 100×.
- Read the account-derived budget, use its pencil to edit, then save or cancel that override. The budget is locked again afterward.
- Choose Manual journal to try an unavailable account balance. The budget is optional and entered-position calculations still work without it.
- Compare account and portfolio values with both margin and leveraged exposure percentages.
- Set the available budget in the position panel, choose a risk target in the sizing assistant, and explicitly apply its suggestion if useful.
- Choose Aggregate or an individual entry from the chart dropdown. Click an entry's plotted label, legend item or editor header to focus it.
- Click anywhere on an entry-header background or its collapsed summary to open the corresponding details. Share inputs and remove buttons keep their own actions.
- Expand the selected entry into a large editable popup, switch entries there, and return with Close or Escape.
- Expand the chart into a large in-page popup and return with Escape. Browser fullscreen is not required.
- Read the bottom summary's modeled profit at targets and loss at stops from your entered position.
- Draw lines, capture the chart, and add free-text context to each capture.
- Switch between thesis, sample strategy versions, evidence, and review.
- Save a draft in this browser, or export it as JSON.

All accounts, portfolio values, prices, balances, and strategies are examples. No broker connection or orders. Portfolio value sums the selected portfolio's sample USD accounts. Margin share and notional exposure share have separate labels; exposure is not capped at 100%. Editing the available budget does not alter account or portfolio values.

The leverage and margin calculations are simplified; fees, funding, slippage, maintenance margin, liquidation, and venue-specific contract rules are excluded. The 1×–100× control is not a claim about any broker's supported range.

Save draft stores one play, its captures, and capture notes in this browser and origin only. It is not a durable journal or cross-device storage. Export JSON includes the images and notes; a capture can also be downloaded as a PNG with its notes below it.

## Check the model and theme palettes

```sh
node --test prototype/*.test.mjs
```

The tests cover 62 model cases and 14 theme/palette cases. The browser smoke runner checks unified selection, expanded entry edits, persistence, aligned column bottoms, bounded overflow, theme geometry, budget controls and evidence notes:

```js
await (await import('/tests/browser-smoke.mjs')).runSmokeChecks()
```

Run that command in an isolated tab on the prototype origin. It deliberately exercises sample data and restores the tab's existing stored draft afterward. Refresh the tab when finished. Browser checks are not a full accessibility audit.
