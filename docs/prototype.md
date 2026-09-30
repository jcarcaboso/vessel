# Prototype scope and LAN operation

Started September 29, 2026. The owner approved the Graphite baseline on September 30, 2026. This remains a disposable prototype, not an agreed production architecture. See [the approved decisions](design/approved-baseline.md).

## What works

- Locked side-by-side desktop workspace with a shared responsive stack. The owner approved moving from layout comparison to visual design; the layout switch is removed.
- Ten dark skins at `/designs.html`, with direct `/?theme=...` URLs and an in-place Design dropdown. Palettes, button treatment, fields, tabs and slight rounding differ; geometry and trade state do not.
- Graphite is the approved default. The palette registry retains a configurable default and existing variants as references for the future theme feature.
- Larger journal fields fill the space below the chart. The sidebar has a bounded desktop height and scrolls internally so both columns finish evenly above the full-position summary.
- Sample portfolio, account, instrument, and direction selection.
- Up to eight independent entries, each with one stop and up to five partial take-profit targets.
- One user-entered full-position margin or quantity, distributed across entries by quantity percentages. There are no independent entry-size inputs.
- Linked leverage slider, precise numeric input, and presets from 1× to 100×. Margin-input mode holds total margin fixed; quantity-input mode holds total quantity fixed.
- Read-only account-derived budget with a pencil to edit, Save/Enter to confirm and Cancel/Escape to discard. An automatic budget follows account selection; a manual override remains unchanged until reset with Use account value. Neither automatically commits a position.
- Missing account balance can remain missing. The Manual journal fixture supports an optional manual budget. Entered-position math still works without one. Account and portfolio percentages stay unavailable, not zero.
- Portfolio and account values alongside both margin and notional exposure percentages. These are sample values, not imported balances.
- A collapsible sizing assistant above the chart using desired loss, available budget, entry prices, exits, and quantity shares. Applying it explicitly copies one total quantity and leverage without changing the shares.
- Adding/removing entries or using Split equally rebalances quantity shares while preserving the full-position input. Adding/removing targets redistributes that entry's exit percentages equally.
- SL/TP input as absolute prices or entry-relative price percentages, with both representations visible.
- Signed all-stops loss and all-targets profit, reward-to-risk, position quantity, notional, required margin, quantity-weighted average entry and leverage in the bottom summary.
- Direction changes mirror each entry's stop and targets around its entry price.
- Synthetic candle views for 1H, 4H, and 1D. A dropdown lists Aggregate and every entry. Editor headers, legend items and plotted entry labels all change focus. Plotted labels also respond to Enter/Space. Aggregate keeps all entries visible when one is focused.
- Clicking the chart bar, whole entry-header background or collapsed entry summary opens the same corresponding details. Share fields and remove buttons retain their independent actions. Selection scrolls only the bounded sidebar to reveal the editor.
- The selected entry can be expanded into its own editable in-page dialog. It reuses the live entry list, supports changing entry, and preserves changes when closed.
- Entry colors persist through selection, saving and deletion of other entries. They match the editor edge, chart levels and legend.
- Simple line annotations, undo, a near-full-window chart dialog, and PNG captures with drawings and per-capture free-text notes. PNG downloads include the notes beneath the image.
- Thesis, invalidation, sample strategy versions, manual outcome notes, adherence, and review.
- Saving one draft in the browser and exporting it as JSON.

The chart is authored SVG, not a trading chart library. Captures rasterize that SVG into PNG. Candles are deterministic synthetic data. The header quote is illustrative and is not computed from a live feed. Drawings use chart-relative coordinates rather than price/time coordinates, so they are only layout experiments. Switching instrument or timeframe clears drawings.

Only the selected entry's editor is expanded. Other entries show a compact price/size summary. Previous saved chart-above preferences normalize to side-by-side; the responsive mobile stack remains.

Entry share inputs remain accessible even when an entry is collapsed. Chart legend buttons select the editor without unexpectedly leaving the aggregate view. Shares split quantity, not margin or independent risk budgets. The planned average is available before size is entered because the configured shares already define it.

Chart expansion uses a native modal dialog, not the browser Fullscreen API. The same chart element moves into the dialog, so controls, drawings and captures remain attached. Close or Escape returns it to the workspace and restores focus to Expand chart. The journal remains outside the popup.

The entry-details dialog also moves the existing editor rather than rendering a second copy with separate state. Close or Escape restores it synchronously to the sidebar and returns focus to Expand entry details. A native close-event handler also covers programmatic close calls.

Desktop workspace height is bounded by the shared baseline stylesheet. The journal grows into the second row while the right panel scrolls. At narrower widths the sections stack, with larger note fields and a bounded entry panel. Geometry is the same across themes.

No broker access, order submission, wallet connection, real market data, fill reconciliation, actual strategy version management, chart-level dragging, external evidence upload, authentication, or backend storage exists.

### Storage and safety

Drafts use local storage under `vessel-prototype-01`, scoped to the browser and origin. A draft saved using the LAN URL will not appear on another device or a different hostname. Save explicitly before refreshing. This is not a durable trading journal.

Draft schema version 3 stores the full-position sizing basis and amount, quantity shares, stable entry color indexes, budget source, and up to eight PNG captures with notes. Save draft and JSON export include them. Download with notes creates a PNG with the note rendered beneath the chart. Notes are plain text, limited to 2,000 characters per capture.

Budget may be `null` within that schema. Missing account balances do not become invented zero balances. Changing a theme never rewrites the play or its evidence. Explicit URLs select a variant; opening the default route starts with the configurable Graphite default and ignores the old `vessel-design` study preference.

Version-2 drafts migrate each entry's old margin or quantity into its corresponding quantity, sum those quantities, and derive the new entry shares. This preserves entered exposure, P&L, margin at the saved leverage, journal fields and capture notes. Existing explicit available budgets become manual overrides.

Drafts with no entered size remain empty rather than inventing a trade. Their existing percentages become reviewable quantity shares. Original unversioned drafts retain prices and reasoning and start with an account-derived available budget. Old session-only captures from the first iteration were never saved and cannot be recovered.

Local storage is quota-limited. A failed save reports the failure and leaves the previously stored draft untouched. JSON export can preserve the current in-memory work if local storage is unavailable.

All context is sample data. Use it for layout discovery, not live trading decisions or private trading records. Basic leverage and initial-margin arithmetic is modeled; fees, funding, spread, slippage, gaps, contract multipliers, inverse contracts, lot rounding, maintenance margin, liquidation, and currency conversion are not. Planned loss at a stop is not a guaranteed loss limit. The prototype warns about leveraged scenarios, loss above the desired risk budget, required margin above sample equity, and modeled entry loss at or above committed margin.

### Calculation basis and limits

See the sizing contract in [the project brief](project-brief.md#simplified-prototype-sizing). Margin-input size changes with leverage. Quantity-input size does not. SL/TP percentages are price moves, not return on margin. The assistant's lowest-fitting integer leverage is a stated prototype assumption, not an investment recommendation.

The entered-position calculator does not require an account value. The optional assistant needs a positive risk reference and available budget. If account value is unavailable, an explicitly supplied manual budget can be the risk reference; the UI names it instead of presenting it as account equity.

The implementation's margin arithmetic was cross-checked against Hyperliquid's official [margining documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining). That documentation uses mark price and asset-specific maximum leverage, plus venue maintenance-margin rules. Vessel deliberately substitutes planned entry price for this pre-trade example and does not implement those venue rules. The 100× UI limit must not be read as a supported Hyperliquid setting.

## Current server

- Host: `ai-auto-001`
- LAN interface: `ens18`
- LAN address: `10.1.0.219`
- URL: http://10.1.0.219:5173/
- Service: user-level transient `vessel-prototype.service`
- Document root: `/home/ops/projects/vessel/prototype`
- Listener: `10.1.0.219:5173`, not all interfaces

Only the prototype directory is served. Repository metadata, project notes, and credentials are outside the document root. Assets, including the Manrope font and its license, are local; no third-party network requests are needed to view the page.

The server has no authentication or TLS. TCP 5173 is allowed only from `10.1.0.0/24` arriving on `ens18` to `10.1.0.219`. No public Site or reverse proxy was created.

### Start and stop

From this machine as `ops`, start the transient service when it is not already running:

```sh
systemd-run --user --unit=vessel-prototype \
  --description='Vessel disposable LAN prototype' \
  --property=WorkingDirectory=/home/ops/projects/vessel \
  --property=Restart=on-failure --property=RestartSec=3 \
  -- "$(command -v python3)" -m http.server 5173 \
  --bind 10.1.0.219 --directory /home/ops/projects/vessel/prototype
```

```sh
systemctl --user status vessel-prototype.service
systemctl --user stop vessel-prototype.service
journalctl --user -u vessel-prototype.service --no-pager -n 30
```

Static edits appear on browser refresh. No build or restart is needed. This transient service is not configured to return after a server reboot.

### Temporary firewall rule

The owner authorized opening the port. The rule is temporary and disappears on firewall reload or reboot. It follows the machine's existing `nixos-fw` structure. No declarative NixOS configuration was changed.

Check the rule, or add it only if missing:

```sh
sudo iptables -C nixos-fw \
  -i ens18 -s 10.1.0.0/24 -d 10.1.0.219/32 -p tcp --dport 5173 \
  -m comment --comment vessel-prototype-lan -j nixos-fw-accept ||
sudo iptables -I nixos-fw 1 \
  -i ens18 -s 10.1.0.0/24 -d 10.1.0.219/32 -p tcp --dport 5173 \
  -m comment --comment vessel-prototype-lan -j nixos-fw-accept
```

Remove only this prototype's rule:

```sh
sudo iptables -D nixos-fw \
  -i ens18 -s 10.1.0.0/24 -d 10.1.0.219/32 -p tcp --dport 5173 \
  -m comment --comment vessel-prototype-lan -j nixos-fw-accept
```

## Verification

```sh
node --test prototype/*.test.mjs
node --check prototype/app.mjs
curl --fail http://10.1.0.219:5173/ -o /dev/null
ss -ltnp '( sport = :5173 )'
```

Browser smoke checks, run from an isolated tab's console on the prototype origin:

```js
await (await import('/tests/browser-smoke.mjs')).runSmokeChecks()
```

The runner exercises sample data, records checks and restores the previously saved draft and legacy design preference. Refresh that isolated tab afterward. It should not be run in a tab containing unsaved real work.

Model tests cover the sample, mirrored shorts, partial targets, risk-weighted aggregate reward-to-risk, stop-driven sizing, invalid prices and allocations, non-finite inputs, numeric overflow, and malformed saved drafts.

Browser verification uses a disposable local Chromium session, not a production dependency. T3's collaborative preview initially opened but its automation host then became unavailable. Successful local HTTP requests establish server health, not reachability from every LAN client.

Initial LAN iteration verification:

- All 22 model tests and the JavaScript syntax check passed.
- Chromium covered risk changes, invalid stops, partial targets, entry addition/removal, direction, context selectors, both layouts, notes across tabs, sample strategy versions, saving/reloading, malformed-draft recovery, drawing/undo, captures/downloads, JSON export, planned status, and fullscreen.
- No horizontal overflow at 1440, 1024, 768, 390, or 320 CSS pixels.
- No JavaScript errors or external asset requests during those checks.
- LAN-address HTTP returned 200, the listener was bound to the expected address, and the subnet-specific firewall rule was read back.

These checks do not establish broker-accurate calculations, accessibility conformance, production readiness, or connectivity from a separate LAN device.

Sizing and evidence iteration verification:

- All 45 model tests passed, including suggestion isolation, explicit application, leverage boundaries, margin/quantity behavior, long/short percentage conversions, quantity-weighted averages, partial-target outcomes, old-draft migration, and capture-note validation.
- Chromium checked empty entered sizes; apply versus ignore; invalid assistant settings with valid entered P&L; both size bases; leverage validation; price/percent conversions; price edits in each mode; long and short; selected/aggregate charts; zero-size entries; partial targets; capture-note persistence through tabs and reload; PNG with notes; JSON including images; storage-quota failure; and legacy draft migration.
- Browser layout checks passed at 1440, 1024, 768, 390, and 320 CSS pixels. No JavaScript exceptions were recorded in those checks.
- Captured PNG output was visually inspected with multiline text and HTML-like text rendered literally, not interpreted.

Full-position iteration verification:

- All 59 model tests passed. They cover full-position quantity and margin distribution, shared leverage, weighted average, entry-share validation, partial exits, assistant isolation, account-derived/manual budget behavior, portfolio/account percentages including exposure over 100%, stable color assignment, and v2 exposure-preserving migration.
- Chromium checked one position input, synchronized leverage slider/number/presets, invalid leverage, quantity share editing, helper application without share changes, capital reference values, account-linked and manual budgets, add/remove/rebalance behavior, matching chart/card/legend colors, and stable colors after deletion.
- The expanded chart was checked as an in-page modal with no browser fullscreen element. Escape returned the same chart to the page and restored focus. Drawing and capture also worked inside the modal.
- Captures, notes, JSON export and saved reload were checked after the sizing changes. A saved v2 mixed margin/quantity position migrated without changing its notional, stop loss or journal text.
- Both layouts and the chart popup were checked for horizontal overflow at 1440, 1024, 768, 390 and 320 CSS pixels. No JavaScript exceptions were recorded.

Locked-layout dark-design iteration verification:

- All 75 tests passed: 62 model cases, including absent balances and nullable budgets, plus 13 theme/palette cases.
- Chromium checked budget read-only/edit/save/cancel behavior, optional missing-balance budgets, manual risk-reference labeling, chart dropdown/plot/editor/keyboard selection, bottom leverage, normalization of the old layout preference, draft persistence and in-place theme changes.
- The heading, account context, capital context, workspace, chart, position editor, journal and summary had matching geometry across all ten variants. Mobile and expanded-chart views were checked for overflow.
- Palette tests require 4.5:1 text contrast. Computed-style browser checks additionally sampled 834 visible text/control pairs per variant across multiple workspace and journal states; all sampled pairs passed. Evidence with capture notes and the ten-card comparison page were also checked.
- Ten JPEG previews were generated from the same synthetic play. The comparison page loaded all ten images and exposed the ten correct variant links.
- No browser JavaScript exceptions were recorded. These checks are not full accessibility conformance or production readiness. See [design studies](design/design-studies.md) for the palette/component choices and contrast methodology.

Approved baseline verification, September 30, 2026:

- All 76 model/theme tests passed, including the configurable Graphite default and fallback.
- The browser smoke runner checked unified chart/header/editor selection, input action isolation, editable entry expansion, modal save and Close/cancel restoration, focus, bounded sidebar overflow, journal/sidebar bottom alignment, all-ten-theme geometry, budget controls, journal fields and capture-note persistence.
- T3's collaborative preview was used for those checks. Its screenshot/resize tools were unreliable; its page evaluator and navigation supported the verification. Responsive geometry was checked using same-origin browser frames at 1440, 1024, 768, 390 and 320 CSS pixels.
- Desktop journal and sidebar bottoms aligned, the summary followed them, selected-entry modal dimensions fit the viewport, and no horizontal overflow was observed at the tested widths.
- This verifies the prototype baseline, not broker accuracy, production readiness or complete accessibility conformance.
