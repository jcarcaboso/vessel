# Venue instruments, price rules and market-data contracts

October 5, 2026, slice S3 of the RISEx-first plan ([risex-integration.md](risex-integration.md)). It builds on S1 ([venue registry](venue-registry.md)) and S2 ([execution facts](execution-facts.md)). Behaviour for Hyperliquid is unchanged.

## Instruments

`VenueInstrument(ContractId, QuantityDecimals, MaxLeverage, QuoteAsset, PriceStep?, Category?, VenueContractId?)`:

- **`ContractId`** is Vessel's instrument key: the canonical asset (`BTC`, `DOGE`). Plays, drawings, matching and the chart use it.
- **`VenueContractId`** is the venue's own identifier when it differs, such as RISEx's numeric `market_id`. Imported fills and orders store it beside the key (nullable column on both tables, migration `VenueContractIds`). Hyperliquid leaves it null because its coin name is the key.
- **`PriceStep`** is the instrument's tick when the venue has one.
- **`Category`** labels non-crypto markets (`stocks`, `commodity`, `index_etf`). The instrument picker shows a tag for them (decision: include every RISEx category, tagged).

Deferred to the Lighter phase: the multiplier part of the canonical key and the Hyperliquid `k…` → `1000…` data migration, since RISEx has no multiplier contracts.

## Price rules

`VenueDescriptor.PriceRule` is `significant-figures` (Hyperliquid) or `tick-size`.

- **Matching:** `ExecutionMatcher.Near` accepts the larger of one fifth-significant-figure step and one tick. On October 5, four RISEx markets (DOGE, PUMP, CRCL and a retired DOGE) had a tick coarser than that step. A tick finer than the step never tightens the tolerance. For `tick-size` venues the execution check reads the catalogue for ticks. If that read fails, matching falls back to the significant-figure step instead of failing the check.
- **Chart:** prices placed or dragged on the chart round to the instrument's tick when there is one (`formatDraggedPrice(price, step)`), otherwise to five significant figures. Typed prices are kept as entered.

## Market data

- **Intervals:** `VenueDescriptor.Intervals` lists the intervals the venue serves natively. Candles and streams refuse others with `Interval must be one of …` built from that list, rather than approximating. `/api/system` publishes `intervals` and `priceRule`. The chart's timeframe bar offers only the venue's intervals and falls back to `1h` (or the first interval) when the saved preference is not served.
- **Notices:** `CandleNotice` and `MarketContextNotice` on the descriptor replace the generic notices. Hyperliquid keeps its exact texts.
- **Loosened fields:** `VenueCandle.Trades` (and `CandleDto.trades`) may be null when a venue reports no trade count. `VenueMarketContext.PreviousDayPrice` may be null, and the chart then shows no 24-hour change. `OraclePrice` keeps its name; for RISEx it carries the index price.

## Tests

- `VenueMarketDataTests`: venue intervals and notices, null trade count and previous-day price, tick-aware tolerance.
- `ApiTests`: the published `intervals` and `priceRule`.
- `InstrumentCatalogueApiTests`: the catalogue's exact shape including the new nullable fields.
- Frontend: tick rounding in `levels.test.ts`, `TimeframeBar.test.tsx`, and system-contract validation of intervals and price rule.
