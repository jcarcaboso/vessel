# RISEx account and venue-neutral UI

October 7, 2026. Screenshots of the production build against **synthetic preview data**: a stub API returns a made-up RISEx account (placeholder address `0x1111…`), positions, fills and candles. They are not a live venue connection or private account data, and the candle shapes are not market data.

They show what the RISEx slices (#12 to #17) and the venue-neutral follow-up (#19) change in the browser. Headless Chromium 1440 px wide, UTC.

| Screenshot | What to check |
| --- | --- |
| `overview.png` | RISEx fills in recent activity next to a Hyperliquid wallet; the account list uses the shared wording. |
| `add-account.png` | The account dialog lists RISEx ("RISEx · read-only perps") and asks for a public address only. |
| `accounts.png` | RISEx row: "USD · venue-reported account value", not a manual or wallet label. The Hyperliquid row keeps its wallet lines. |
| `account-detail.png` | Account value, withdrawable shown as "—" (RISEx reports none), margin used, signed positions with leverage, fills with "P&L after fees" (net-of-fee), and the incomplete-history notice. |
| `instrument-picker.png` | Non-crypto markets carry a tag (Stock, Commodity, Index/ETF); the maximum leverage is per market. |
| `plays-btc-chart.png` | Play on a RISEx contract: no live-updates toggle, a Refresh button and "Updated … UTC"; only RISEx timeframes; 24h change "—" (no previous-day price); trade link "Open BTC/USDC on RISEx". |
| `plays-stock-chart.png` | A stock market (TSLA) with its own tick (0.05): the suggested target (257) is on the tick. |
| `timeframe-menu.png` | The timeframe menu offers 1m, 5m, 15m, 1h, 4h, 1d and 1w, the intervals RISEx serves natively. |
