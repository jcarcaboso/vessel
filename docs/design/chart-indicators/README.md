# Chart indicators

October 8, 2026. Screenshots of the production build (refreshed October 9 after the pane layout fixes for short charts, maximize and captions) against **synthetic preview data**: a stub API returns a made-up Hyperliquid account and generated BTC candles. They are not market data or a live venue connection. Headless Chromium 1600 × 1000 (demo 1280 × 860), dark Graphite theme, UTC. The stub has no market stream, so the live toggle shows Polling.

| File | What to check |
| --- | --- |
| `demo.gif` | Crosshair values in the legend and pane bars, hiding/showing EMA 9, minimizing Volume, maximizing and restoring RSI, hiding and re-showing Volume, changing EMA 2's period and color in the popup, Reset to defaults. |
| `default.png` | Defaults: EMA 9 purple, 21 green, 50 yellow, 200 red on the price pane; Volume and RSI 14 (70/30 guides) in their own panes, each with a bar (minimize, maximize, hide; RSI also has settings). |
| `crosshair-values.png` | Legend and pane bar values follow the candle under the crosshair. |
| `settings-popup.png` | Settings popup from the toolbar's Indicators button: show/hide, period and color per EMA, Volume and RSI toggles, RSI period and color, and the swatch/custom color picker. |
| `volume-minimized.png` | A minimized pane keeps only its bar (values still shown); the price pane takes the space. |
| `rsi-maximized.png` | A maximized pane (here Volume) takes most of the height; the price pane and the other pane keep their minimum heights. |
| `short-chart-open.png` | A 300 px chart: both panes stay open at their 72 px minimum and the price pane keeps 120 px. |
| `short-chart-compacted.png` | A 220 px chart: both panes are shown as bars marked "Too short to plot" (the saved sizes are unchanged and the plots return when the chart grows). |
| `capture-narrow.png` | A capture at 420 px wide: the caption wraps and says a minimized pane is not plotted. |
| `hidden.png` | EMA 9 hidden (dimmed chip with an eye-off icon) and Volume hidden; the legend offers "Volume" to bring the pane back. |
| `expanded.png` | The expanded chart dialog uses the same indicator settings. |
| `narrow.png` | 420 px wide: the legend wraps and the pane bars stay usable. |
