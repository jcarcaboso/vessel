# Normalized execution facts

October 5, 2026, slice S2 of the RISEx-first plan ([risex-integration.md](risex-integration.md)). Builds on the [venue registry](venue-registry.md) (S1). Behaviour for Hyperliquid is unchanged; stored Hyperliquid rows are converted once by a migration.

## Why

Matching, lifecycle and sizing used to read Hyperliquid's encoding directly: `"B"`/`"A"` for sides and `Direction` text starting with `"Close"` for reducing fills. RISEx (and later Lighter) report the same facts differently: RISEx uses `BUY`/`SELL` with a `position_side`, and its `realized_pnl` already has the fee taken off. Each adapter now translates into one vocabulary, and the business logic reads only that.

## Vocabulary (`Vessel.Domain.Workspace.ExecutionFacts`)

| Fact | Values | Meaning |
| --- | --- | --- |
| `Side` (fills and orders) | `buy`, `sell` | Direction of the execution or order. |
| `PositionEffect` (fills) | `open`, `close`, `flip`, `unknown` | Opened or increased, reduced or closed, or flipped the position. `unknown` when the venue's wording does not say; never guessed. |
| `FeeBasis` (fills) | `reported`, `standard-account-free` | The venue's fee amount, or zero because the account tier is fee-free (Lighter Standard). A fee-free basis with a non-zero fee is rejected. |
| `PnlBasis` (fills) | `gross`, `net-of-fee` | Closed PnL before fees (fee reported separately; Hyperliquid) or with the fee already taken off (RISEx). |

`Direction` keeps the venue's own wording for display.

## Rules

- **Adapters** translate. Hyperliquid: `B`→`buy`, `A`→`sell`; `dir` "Open Long/Short" → `open`, "Close Long/Short" → `close`, "Long > Short"/"Short > Long" → `flip`, anything else (liquidation or settlement wording) → `unknown`; closed PnL is `gross`, fees `reported`.
- **Validation:** `VenueFactChecks` rejects adapter output outside the vocabulary before anything is stored. Sync treats it as a venue failure (the account keeps its previous facts and reports a refresh error); an order read answers the usual 502.
- **Matcher:** plan levels carry `buy`/`sell`; a long entry buys and its exits sell.
- **Lifecycle:** an order "closes a position" when any of its fills has a `close` or `flip` effect.
- **Sizing:** a Play's net result is the sum of closed PnL minus the USDC fees of `gross` fills only. `net-of-fee` fills already include their fee, and a fee paid in another token on such a fill does not make the result incomplete.
- **Execution totals** report `closedPnlBasis`: `gross`, `net-of-fee` or `mixed`. The panel labels net-of-fee totals "after fees".

## Persistence

Migration `NormalizedExecutionFacts` adds `PositionEffect`, `FeeBasis` and `PnlBasis` to `imported_fills`, converts existing rows (`B`→`buy`, `A`→`sell`, effect from the stored direction; fees `reported`, PnL `gross`) and only then adds check constraints for all four columns and for `imported_orders.Side`. `Down` converts sides back before dropping the columns.

## API

- `FillDto` (account activity) adds `positionEffect`, `feeBasis` and `pnlBasis`; `side` is `buy`/`sell`.
- Execution fills add `side`, `positionEffect` and `pnlBasis`; execution orders use `buy`/`sell`; totals add `closedPnlBasis`.
- The browser validates these values and stops treating `A`/`B` as sides.

## Tests

`ExecutionFactsTests` (Hyperliquid mapping, vocabulary checks), the net-of-fee cases in `SizingTests`, `NormalizedExecutionFactsMigrationTests` (Postgres: conversion, constraints, no pending model changes) and the execution panel's net-of-fee label. Existing matcher, lifecycle and sizing tests run on the normalized values.
