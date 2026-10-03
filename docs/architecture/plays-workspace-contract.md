# Plays workspace first pass

The chart placeholder is superseded for venue instruments by [the chart plan](chart-plan.md).

October 1, 2026. The owner merged PR #1 and authorized the Plays page, delegated to Sol agents. This step builds the page and components from the approved prototype, with the chart deferred until its renderer and data requirements are researched.

## Scope

- Enable Plays in the existing application shell, including `#plays`.
- Start with an empty local draft, not the old BTC sample fixture.
- Preserve Graphite and the approved capital-above, chart-left, journal-below-chart, position-right and summary-below layout.
- Keep the position sidebar bounded and internally scrollable. Use the same responsive stack and a shared expanded entry form with Escape and focus restoration.
- Edit title, account, venue-backed perpetual instrument where supported or an explicit manual label, direction, whole-position margin or quantity, integer leverage, quantity-share entries, planned stops, partial targets and separate journal notes.
- Use existing API account and portfolio context without mutating accounts or refreshing account balances/fills. Exclude disabled accounts from draft selection.
- Keep wallet availability, primary perpetual equity and portfolio coverage distinct. Wallet availability is not a trading budget or verified collateral. Automatic budget derivation remains unspecified, so budget is unavailable unless the trader explicitly overrides it.
- Keep the chart as an explicit placeholder. Planned-entry selection can still synchronize with the editor, but no candles, prices, fills or execution observations are generated.

## Limits

Drafts exist in React memory only. Navigation within the shell retains the draft; reload or disconnect discards it. Explain this on the page. Do not offer a Play save, publish, execution or lifecycle action. Saving a budget override changes only the local draft.

Payoff calculations remain deferred: no reward-to-risk, stop loss or target profit. Since October 3 the owner asked for position sizing, so margin, position size (notional) and quantity are derived from the chosen size, leverage and planned average entry (see below). Instrument labels do not establish validated quote/base units; the editor labels prices as quote units and sizing as currency or instrument units. Account context and an explicit budget override use nominal USD separately. Price and percentage inputs are distinct local representations; a percentage is the return on margin at the play's leverage (see the October 3 refinements below). Switching units clears the value rather than inventing a conversion.

No Play API, database migration, strategy-version editor, media upload, import allocation, monitoring, notification or chart dependency is added. Existing imported executions remain unassigned. The UI does not enforce a unique account/instrument combination or claim that a local draft is a saved Play.

## Initial first-pass verification

- Frontend type checks, lint, production build and all 131 tests pass. Coverage includes blank drafts, disabled accounts, account-specific budget editing, navigation retention, level-unit changes, partial targets, selection and expanded-dialog state.
- The independent review reproduced repeated legend selection failing to reveal the same entry. A regression test now covers the fixed selection-request path.
- The existing prototype passes all 76 tests. Locked .NET restore and Release build pass; backend tests report 312 passed and 40 PostgreSQL cases skipped because no test database connection was supplied. This frontend-only step does not claim new database verification.
- T3 browser checks use built assets, a synthetic API fixture and fake connection text. They do not contact a venue, real API or database.
- Desktop geometry at 1402 × 877 keeps the chart and journal left, position right and both column bottoms aligned. The sidebar scrolls internally; selection does not move the outer page. Dialog edits survive Escape with focus restored and no duplicate input IDs.
- Responsive browser frames at 1200, 1100, 1001, 1000, 900, 850, 800, 390 and 320 CSS pixels show no horizontal overflow. At 390 and 320 pixels, the shared stack keeps a large journal and bounded editor. The 320-pixel expanded dialog fits the frame and scrolls internally.
- Rendered text/control samples use the Graphite tokens and exceed 4.5:1 text contrast. This is not a full accessibility audit.

The T3 viewport-resize command timed out, so responsive checks used same-origin browser frames with explicit CSS widths rather than device emulation. The existing LAN service, user database, private environment and firewall remain unchanged. No production deployment or remote CI run is claimed.

## Delegation

- Position worker owns `PositionEditor.tsx`, `EntryForm.tsx` and `PositionEditor.test.tsx`.
- Panels worker owns `WorkspacePanels.tsx`, `WorkspacePanels.test.tsx` and `plays-workspace.css`.
- Orchestrator owns `draft.ts`, `PlayWorkspace.tsx`, shell integration, workspace tests, documentation and verification.

Workers share the local draft types in `frontend/src/features/plays/draft.ts`. No worker commits independently.

## Owner refinements

October 1, 2026. The owner requested venue-backed instruments where possible, a green Long/up-arrow and red Short/down-arrow toggle, whole-number leverage and closer fidelity to the approved prototype. This supersedes the initial manual-only instrument control, not the deferred chart or persistence scope.

The existing shell navigation remains. Within Plays, use the prototype's editable title heading, compact portfolio/account/instrument/direction context, capital strip, collapsed assistant, position controls and entry-level switches. Do not mount prototype samples, enable unsupported lifecycle actions or move the locked workspace sections.

Shared authenticated API contract: `GET /api/accounts/{id}/instruments` returns:

```json
{
  "venueId": "hyperliquid",
  "marketScope": "perpetuals",
  "scope": "primary-perpetual-dex",
  "instruments": [
    { "contractId": "BTC", "quantityDecimals": 5, "maxLeverage": 40 }
  ],
  "notice": "Primary perpetual DEX metadata only. No orders, balances or execution refresh."
}
```

The numbers above illustrate the shape, not current venue limits. Manual accounts return the same shape with `scope: "manual"`, their venue ID, an empty instrument list and a manual-catalogue notice. Missing/foreign accounts return 404; disabled accounts return 409 without a venue read; safe venue failures return 502. The application owns the contract and reuses the existing adapter's fixed `/info` request, cancellation, deadline and response bounds. No new persistence, account refresh or source credentials.

Hyperliquid choices come from a metadata-only read of the primary perpetual DEX. Preserve exact contract IDs and exclude delisted contracts from selectable choices without changing historical-fill recognition. The UI loads when an enabled Hyperliquid account is selected, cancels stale reads, offers retry, and clearly labels an explicit manual fallback when unavailable. Account changes clear the prior instrument and local budget rather than carry a venue contract into another account.

The displayed catalogue does not validate a complete order or position, price/base/quote units, margin tiers or trading eligibility. Keep sizing/payoff calculations deferred. Leverage controls use whole multipliers. With a venue contract the range is that contract's catalogue maximum; choosing a contract with a lower maximum lowers the plan's leverage to it, and a saved plan above it is flagged. Without one, the range is 1× to 100×. Size is never resized from metadata.

Follow-up worker scopes:

- Backend worker owns backend implementation/tests only.
- UI worker owns `DirectionToggle.tsx`, its tests, `PositionEditor.tsx`, `EntryForm.tsx`, `PositionEditor.test.tsx` and `plays-workspace.css`.
- Orchestrator owns instrument API/client and picker, `PlayWorkspace.tsx`, journal/capital component composition, shell integration, documentation and full verification.

### Refinement verification

- `pnpm check` passes all 164 frontend tests, 387 backend tests and 76 unchanged prototype tests, types, lint, locked restores and both builds. Forty PostgreSQL cases explicitly skip without a test connection; no new database-verification claim.
- The metadata route has provider/service/API coverage for authentication, ownership, disabled/manual accounts, exact IDs, delisted choices versus retained historical fills, bounded bodies/depth/deadlines, cancellation and no refresh/write side effects.
- A single public `/info` metadata request supplied no account address. Its saved response had 234 universe entries; an offline smoke through the compiled adapter returned 178 non-delisted choices with exact IDs/decimals/leverage. These are observation-time counts, not hard-coded product options or guaranteed availability.
- Client tests cover loading, safe errors/retry, explicit manual provenance, wrong-venue data, cancellation and stale results, account/instrument/budget clearing, and portfolio-filter changes. Independent review found an obsolete hidden portfolio filter reappearing after a metadata move; guarded state normalization fixes it, with a regression test.
- T3 comparison used the actual approved Graphite prototype and built application, not another design mockup. The desktop workspace is 940 pixels tall with roughly 64/36 chart/journal heights, aligned column bottoms and an internally scrolling entry sidebar. Existing application navigation remains.
- Native browser interaction confirmed green/up Long and red/down Short, pressed states, decimal leverage input normalizing to an integer, and arrow-key slider changes of one whole multiplier. It also covered catalogue loading, failure, manual fallback and retry, using fixture accounts and the saved public catalogue rather than a real wallet session.
- Responsive browser frames at 1200, 1001, 900, 850, 800, 390 and 320 CSS pixels showed no horizontal overflow with the catalogue loaded. The 320-pixel expanded form fits, uses unique IDs, and restores trigger focus on native Escape.

Chart rendering/research, payoff rules and Play persistence remain deferred. No dependency, migration, user-record, private-environment, firewall or existing LAN-service changes. No push, PR, deployment or remote CI is claimed.

## Navigation and visual polish

October 1, 2026. The owner requested icon-only desktop navigation and further prototype-led visual refinement.

- Desktop navigation toggles between the existing expanded widths and a 78-pixel icon rail. State lasts through shell navigation without browser storage. Labels remain accessible; icons have native tooltips and active-page markers.
- At 800 pixels and below, the full 236-pixel mobile drawer overrides desktop collapse. Its focus, inert background and Escape behavior remain unchanged.
- Graphite section positions and shared responsive stack remain fixed. The recovered canvas at the 1402-pixel browser width gives a chart/journal column of about 895 pixels and a position editor of about 340 pixels, closely matching the prototype.
- Controls have grouped direction tracks, colored selection indicators, clearer entry selection, native slider progress/thumb styling, softer surfaces and more readable journal text. A restrained grid and icon identify the chart placeholder without fabricating data. Draft wording distinguishes unsent edits from permitted metadata reads.
- `pnpm check` passes 169 frontend, 387 backend and 76 prototype cases; 40 PostgreSQL cases explicitly skip without a test connection. The final phone-layout adjustment also passed types, lint, frontend tests and build.
- Native T3 checks verify 78-pixel desktop collapse, aligned 940-pixel columns, icon-link names/tooltips, and text contrast above 4.5:1. At 320 pixels, the drawer remains 236 pixels, desktop collapse is hidden, no page overflow occurs, and the bounded editor and expanded dialog remain usable. Native Escape restores focus for both drawer and dialog.

T3 snapshot and viewport-resize calls timed out during this pass. Geometry/control checks used the native browser and a same-origin 320-pixel frame; a T3 recording was captured. No new screenshot, device emulation or full accessibility audit is claimed. No backend, dependency, user-record, private-environment, firewall or existing LAN-service changes in this styling pass.

## PR review polish

October 1, 2026. Review of PR #2 against the approved Graphite prototype, using a fixture API and headless Chromium screenshots at 1402, 1200, 1001, 900, 800, 390 and 320 CSS pixels.

- Journal tabs share the heading row, as in the prototype, and the repeated per-tab label is screen-reader only. At 1402 pixels the note field grows from about 124 to 204 pixels without moving any locked section.
- The position editor restores the prototype's "Distribute your entries" heading with entry count, the plain sum of entered quantity shares and an explicit Split equally action (two decimals, remainder on the last entry). Adding an entry still leaves its share blank. The share total is bookkeeping, not position validation.
- Leverage gains the prototype's 1×, 5×, 10× and 25× presets. They set the same whole-number draft value as the slider and input.
- "Expand selected entry" now uses the same 10-pixel button text as its siblings. `DialogTrigger asChild` replaces the button's `data-slot`, so the shared rule did not apply.
- Number spinners are hidden in Plays fields so short values such as a 100% target share fit at 320 pixels. Direction spans two context columns between 851 and 1050 pixels instead of crossing the divider.
- The application has an inline favicon, removing the only console error.

`pnpm check` passes 171 frontend, 387 backend and 76 prototype cases; 40 PostgreSQL cases still skip without a test connection. No page-level horizontal overflow at the widths above; columns stay aligned at 940 pixels; Escape restores focus from the expanded editor. T3 preview automation timed out again, so screenshots used a local headless Chromium against a synthetic API.

### Code review and second polish pass

- Backend review found no defects: authentication precedes venue reads; owner, disabled and manual guards hold; delisted contracts are excluded only from choices; provider failures map to a generic 502 without touching sync state; caller cancellation is not a provider failure.
- Frontend fix: when a successful reload disables or deletes the draft's account, the draft clears account, instrument and budget like an explicit account change. Previously a venue contract stayed in the draft and was shown as a manual label. Loading and failed reloads keep the last known list, so a transient error does not clear the draft. A regression test covers both disable and removal.
- The summary gains the prototype's intro column: entry count, Long/Short in direction colour, instrument and leverage. "Not calculated", "Not chosen" and "Unavailable" values are muted so real figures carry the weight. Entry headers show the planned entry price once entered. Context status reads "Draft" instead of repeating the heading's "Local draft". The shell footer uses singular/plural account wording.
- `pnpm check` passes 172 frontend, 387 backend and 76 prototype cases; 40 PostgreSQL cases skip without a test connection. No page or element overflow at 1402–320 pixels; columns remain aligned at 940 pixels.

## October 3 refinements

After PRs #5 and #6 merged, the owner asked for several stop losses, percentages that follow the leverage, more chart tools, venue leverage limits and instrument search.

- **Several stops**: each entry has a list of stops like its list of targets. Each stop and target has its own unit and a share of the entry it closes. A new entry starts with one blank stop and one blank target at 100%. The `MultipleStops` migration turns each stored single stop (plans and plan revisions) into a one-item list at 100% and names the stop on existing stop order links.
- **Percentages**: a stop or target in % is the return on margin at the play's leverage. The price moves % ÷ leverage from the entry, on the side the direction gives: at 10×, a 20% stop on a 2711.3 long sits at 2657.1. The editor shows that price and the price move under each % field. Changing leverage moves % levels; the order matcher resolves them the same way. Stored values are not converted: existing % levels are now read at the plan's leverage.
- **Instruments**: the catalogue reports a quote asset per contract (`quoteAsset`, USDC for Hyperliquid primary perps). Venue contracts show as pairs (BTC/USDC) in the picker, the fixed instrument field, the venue link and the plays list; the stored contract ID is unchanged. The picker is a searchable combobox: type to filter (exact, then prefix, then contains, keeping the venue's order), arrow keys and Enter to choose, Escape to keep the current choice.
- **Leverage changes with % levels**: with any stop or target in %, the leverage controls preview a new value and apply it only after a dialog. It lists each % level's price now, with prices kept (the % is rescaled by new ÷ old leverage) and with the % kept (the level moves), plus how the size changes. The owner keeps prices, keeps % or cancels. Without % levels, leverage applies at once. Clearing the number field and leaving it keeps the current leverage.
- **Position size**: margin sizing fixes the margin, so notional = margin × leverage and quantity = notional ÷ planned average entry. Quantity sizing fixes the quantity, so notional = quantity × planned average entry and margin = notional ÷ leverage. Figures are before fees, funding and venue margin rules, in the contract's quote asset and base (generic units for manual instruments), with the venue's quantity decimals. They show under the size input and in the full-position summary, which says what is missing (a size or an entry price) instead of a figure.
