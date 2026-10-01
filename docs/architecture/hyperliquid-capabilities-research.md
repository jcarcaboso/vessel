# Hyperliquid read-only capabilities

Applicable and checked September 30, 2026. Official documentation only, with official SDK corroboration for orders. No live-account queries, credentials, archive downloads, implementation or package decisions. Availability below does not establish complete history.

## Account state and assets

`clearinghouseState` returns current perpetual positions, signed size, entry price, leverage, liquidation price, unrealized PnL, margin summaries and withdrawable balance. Its optional `dex` defaults to the original perpetual DEX; `perpDexs` discovers other DEXs. These are current snapshots, not position histories. [S4]

`spotClearinghouseState` returns token totals, holds and entry notional. Official docs identify it as the balance source of truth across spot/perpetuals under unified account or portfolio margin. Do not assume the perpetual margin summary always represents the entire trading balance. [S5]

`meta` exposes the perpetual universe, quantity precision, leverage constraints and margin tables; `metaAndAssetCtxs` adds mark/oracle prices, funding and open interest. [S4] `spotMeta` exposes token IDs, precision and pair/token mappings; `spotMetaAndAssetCtxs` adds market contexts. Preserve venue identifiers rather than assuming display symbols uniquely identify instruments. [S5]

## Executions and orders

`userFills` returns at most 2,000 latest fills. `userFillsByTime` returns at most 2,000/response, restricted to the latest 10,000 fills, not calendar retention. Bounds are inclusive epoch milliseconds; omitted `endTime` means now. [S1], [S2]

The general rule says 500 elements/distinct blocks, paging from the last returned timestamp. Its interaction with 2,000 fills is unexplained. [S3] Inference: overlap/deduplicate boundaries; same-millisecond saturation has no documented cursor.

`aggregateByTime=true` merges crossing-order partials and resting-order partials within one block. [S1], [S2] Inference: request false when preserving individual execution records.

`openOrders` and `frontendOpenOrders` provide outstanding orders, with trigger/reduce-only details in the latter. `historicalOrders` exposes at most 2,000 latest orders, without date-range parameters. Official docs and SDK agree. [S6], [S14] `orderStatus` queries an order ID or client order ID, but is not a history pager. [S14]

WebSocket fills include asset, executed price/size/time, order ID, trade ID, transaction hash, fees/fee token and closed PnL. Order updates carry order details, status and status timestamp. [S7]

## Historical market data and import completeness

`candleSnapshot` accepts instrument, interval and millisecond bounds; only 5,000 latest candles are available. Intervals span `1m` through `1M`. [S8]

Official archives provide node fills in `hl-mainnet-node-data/node_fills_by_block`, with older formats in `node_fills` and `node_trades`. Requesters pay transfer costs. Documentation does not establish earliest coverage or continuous account-lifetime completeness. [S9]

The separate `hyperliquid-archive` supplies book snapshots and asset contexts, approximately monthly, explicitly allowing missing data and delayed updates. It does not supply candles or spot asset data. Do not misread that asset-archive restriction as excluding the separately documented node-fill archive. [S9]

Import conclusion: offer all retrievable records or a requested date range, with completeness unproven. Current snapshots and archive availability do not establish lifetime execution coverage. [S4], [S9]

## Streaming and reconnect recovery

Mainnet WebSocket is `wss://api.hyperliquid.xyz/ws`. Servers can disconnect without notice; reconnect and resubscribe. Official guidance says missed data appears in the reconnect snapshot and can also be queried through corresponding info requests. [S10]

`userFills` subscribes by address, with optional aggregation, and sends an initial `isSnapshot=true` followed by streaming updates. `orderUpdates` subscribes by address. No numeric fill-snapshot retention, durable replay cursor or order-update replay window is specified in these pages. [S7] Inference: long-outage recovery is not proven. Reconcile overlapping fill history and current/historical order state; deduplicate rather than treating snapshots as new executions.

After 60 seconds without a server message, the server closes the connection. Application `{"method":"ping"}` receives `{"channel":"pong"}`. [S11]

## Limits and execution evidence

Per IP, REST shares 1,200 weight/minute. Account states, mids and order status cost 2; other relevant info requests cost 20. Fills/history add weight per 20 returned items; candles per 60. Address-based action limits do not apply to info requests. [S12]

Inference: parallel imports share capacity. Throttling must account for response size, not just request counts. [S12]

WebSocket limits per IP are 10 connections, 30 new connections/minute, 1,000 subscriptions, 10 distinct user addresses, 2,000 outbound messages/minute and 100 in-flight post messages. [S12]

Market-price touch is not a confirmed Fill. TP/SL uses mark-price triggers; a triggered limit order can rest without execution. Preserve the distinction between a trigger and venue-reported executed quantity. [S13], [S7]

## Primary sources

[S1]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills
[S2]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-fills-by-time
[S3]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#pagination
[S4]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
[S5]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot
[S6]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-a-users-historical-orders
[S7]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
[S8]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot
[S9]: https://hyperliquid.gitbook.io/hyperliquid-docs/historical-data
[S10]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
[S11]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats
[S12]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
[S13]: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl
[S14]: https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py
