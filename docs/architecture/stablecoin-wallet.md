# Stablecoin wallet availability

October 1, 2026. The owner reported missing Hyperliquid available funds and authorized stablecoin retrieval. The old reader used primary `clearinghouseState` only. The configured account is unified mode, whose wallet source is the spot ledger; its zero primary perpetual snapshot was not its wallet balance.

## Scope and identities

Refresh additionally reads `userAbstraction`, `spotMeta` and `spotClearinghouseState`. Perpetual positions/history remain primary-DEX-only; spot trading is not enabled.

Supported assets are USDC, USDE, USDT0 and USDH. Identity uses curated token IDs plus current metadata index/name mappings, not ticker or `isCanonical` alone. The official public metadata marks only USDC canonical, so that flag would exclude the other three incorrectly.

| Symbol | Exact HyperCore token ID |
| --- | --- |
| USDC | `0x6d1e7cde53ba9467b783cb7c530ce054` |
| USDE | `0x2e6d84f2d7ca82e6581e03523e4389f7` |
| USDT0 | `0x25faedc3f054130dbb4e4203aca63567` |
| USDH | `0x54e00a5988577cb0b0c9ab0cb6ef7f4b` |

## Value meaning

- Total/Held are exact venue token units. Available is exact `Total - Held`.
- This is wallet/order-hold availability, not guaranteed perpetual collateral, borrowing or withdrawal capacity.
- Primary perpetual equity/withdrawable/margin fields stay separate. They are never added again to the wallet as total equity.
- Overview/account rows show available wallet stablecoins prominently. Account detail shows each supported coin's amounts.
- Nominal summaries assume one nominal unit per supported USD-pegged token. There is no pricing, FX, depeg or full-account valuation. Exact strings and integer-arithmetic sums avoid decimal addition rounding.
- HYPE, UBTC and other assets, HyperEVM wallets and lending/borrow accounting are excluded.

Empty wallets are zero only after a valid observed balance-array read. Missing metadata does not invent tokens; old snapshots remain unknown until refreshed. Invalid identities/numbers/holds or request failures preserve prior successful data. Six sequential requests share one 20-second deadline, but are not an atomic venue snapshot.

## Persistence and API

Migration `20261001125452_StablecoinWallet` adds observation/mode/scope fields and owner-scoped `account_stablecoins`, keyed by owner/account/token ID. Replacement is transactional with the existing account lock and snapshot. Disable hides wallet rows without deletion; enable restores them. Account deletion cascades through the snapshot.

`SnapshotDto.stablecoinWallet` is nullable, with observation time, mode, scope, balances and caveats. Account DTOs add available nominal wallet amount, scope and mode. Overview totals add that amount and observed enabled-account count. Existing perps/manual value fields are not silently redefined.

## Verification

`pnpm check` passed 452 cases: 299 backend, 77 frontend, 76 unchanged prototype. Adapter coverage includes 169 fixture cases across six requests. Three new PostgreSQL cases cover exact persistence, isolation, replacement/empty/unknown observations, failure retention, disable/enable and deletion. Previous migration/API-shape expectations were updated.

After migration, the user's configured account was refreshed once under the request. Positive available unified-wallet funds and the supported symbols were verified without copying balances, addresses or credentials to logs/docs. Non-stable assets were excluded, perps fields remained separate and fills deduplicated. Native LAN login verified a nonzero wallet metric and no alert. The preview token and user records remain unchanged.

Primary sources: [account modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes), [spot info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot), [info requests](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint). Token identities were checked against official public spot metadata. No signing or order request occurred.
