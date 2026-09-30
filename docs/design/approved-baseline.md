# Approved play-workspace baseline

Confirmed by the owner on September 30, 2026. This records the starting point for implementation, not a production technology decision.

## Layout and appearance

- Side-by-side desktop workspace: chart on the left, whole-position sizing and entry editor on the right.
- Capital context and the optional sizing assistant remain above the workspace.
- Thesis, invalidation, strategy, evidence and review stay in the separate journal below the chart.
- The journal fills the remaining left-column height. The right editor is height-limited and scrolls internally, so both columns finish together.
- The full-position summary follows immediately beneath the workspace, including leverage.
- Mobile uses the same sections in a responsive stack, with larger note fields and a bounded position editor.
- Graphite is the selected default: sober dark surfaces, readable text, restrained accents and slightly rounded borders.
- Configurable palettes are an accepted product capability to carry into the later implementation. The prototype's palette registry remains reusable; the other nine studies remain references, not separately implemented products.

## Selection and expanded editing

- Chart legend/bar items, plotted entry labels, the entry dropdown, the entry-name button and the whole entry-header background select the same editor.
- Selecting an entry while Aggregate is displayed keeps the other entries visible. Focus and chart filtering are distinct.
- Entry-share inputs and remove buttons do not accidentally select another entry.
- Selection reveals details by scrolling the bounded editor, not by moving the entire page away from the chart.
- Chart expansion and selected-entry expansion use in-page dialogs, not mandatory browser fullscreen.
- The expanded entry editor reuses the live form. Its entry selector can switch entries; edits apply to the same play.
- Close or Escape returns the editor to its sidebar location and restores focus.

## Position and journal controls

- One full-position margin or quantity, allocated by entry quantity percentages.
- Shared leverage with a slider and precise numeric input.
- Independently defined stops and partial targets per entry, editable as prices or entry-relative percentages.
- Quantity-weighted planned entry price and consistent entry colors across chart and editor.
- Read-only account-derived available budget. A pencil opens an explicit save/cancel override. Missing balances and budgets can remain unavailable.
- Distinct account and portfolio value, committed margin and notional exposure, with separate percentage labels.
- Suggestions do not overwrite the entered position until explicitly accepted.
- The summary uses the entered position and shows modeled all-stops loss and all-targets profit, size, margin, exposure, average entry and leverage.
- Chart captures retain free-text context. Thesis, strategy and post-trade review are separate from entry details.

## Prototype boundaries

These are approved interface decisions, not claims of broker integration, actual executions, reliable storage or production-ready financial calculations. The sample values, linear payoff math, 1×–100× control range, percentage conversion rules and browser-local persistence have the limitations documented in [the project brief](../project-brief.md) and [prototype guide](../prototype.md).

The original sketches and the owner's final [entry-selection](../references/entry-selection-review.png) and [journal-height](../references/journal-height-review.png) screenshots are preserved as discovery references.

## Implementation handoff

The initial Git commit preserves the prototype, glossary, brief, design studies, approved decisions, tests and reference assets. HTML, browser JavaScript, authored SVG and the Python static server are disposable prototype tools. They do not decide the backend, frontend framework, database, chart provider or deployment architecture.

The next discussion is the backend and frontend stack. Production implementation should preserve this approved UX while replacing sample-data and browser-only behavior deliberately. Play remains provisional terminology; execution reconciliation, durable evidence, account integrations and strategy history still need design.
