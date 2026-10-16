# Lighter on Robinhood Chain: settled funding verification

Verified **October 16, 2026**, against the first-party sources below. Scope:
actual account funding payments, not public funding rates or estimated costs.
The mainnet worker owns the shared `LighterReader.Funding.cs`; this verification
does not introduce a second adapter. See [the RH integration contract](robinhood-lighter-integration.md).

## Result

- Use RH's authenticated `GET /api/v1/positionFunding`, following its cursor.
  Its published request and payment schema match the mainnet protocol. [1–5]
- RH collateral is **USDG**, not USDC. The public RH asset metadata identifies
  it as asset **3**, with six decimals. Do not reuse mainnet market/account
  indexes, tokens or ledger currency. [1, 6, 7]
- Preserve the signed reported `change`: **positive received, negative paid**.
  Do not reconstruct it from rate, size, side or discount. [8, 9]
- **Execution PnL funding basis remains `FundingFacts.Unknown`.** Position-level
  realized PnL is documented to include funding, but that does not establish the
  basis of the execution fields Vessel imports. Never add funding to an
  execution result whose funding basis is unknown. [10, 11]

## Endpoint and pagination parity

The RH Get Started page links its own downloadable OpenAPI document. Its
`/api/v1/positionFunding` operation returns `PositionFundings`: required `code`
and `position_fundings`, optional `message` and `next_cursor`. Parameters: [2–5]

| Input | Published shape |
| --- | --- |
| `account_index` | Required signed 64-bit integer |
| `limit` | Required integer, **1–100** |
| `cursor` | Optional opaque string |
| `side` | `long`, `short`, `all`; default `all` |
| `start_timestamp`, `end_timestamp` | Optional signed 64-bit integers |
| `market_ids` | Optional array; description says comma-separated IDs |
| `authorization` | Header, not a required query-string credential |

Each payment requires `timestamp`, `market_id`, `funding_id`, `change`,
`discount`, `rate`, `position_size` and `position_side`. Amount-related fields
are strings; the side is `long` or `short`. The timestamp example is Unix
seconds (`1640995200`). The RH production SDK and history table use the same
model and follow `next_cursor`. The current Python SDK also puts authorization
in the header. [3, 5, 9]

**Coverage rules for Vessel:** preserve the caller's exact inclusive window;
widen second-resolution API bounds before filtering rows back to that window.
Do not assume a short page means exhaustion, chronological order, or unique
`funding_id` across markets. Follow cursors to exhaustion. A paging ceiling,
repeated cursor, unknown native market, malformed page or failed authentication
must not become a verified empty window. A market/funding composite identity
keeps native contracts separate, including inactive contracts with a reused
symbol. These are defensive adapter decisions, not promises made by the API.

The published contract does **not** specify the timestamp-filter units or
inclusive/exclusive boundary behavior, ordering, maximum REST date span,
retention guarantee, or global uniqueness of `funding_id`. RH's history guide
does document **three months of funding payments for CSV export**; that is not
a stated retention/date-span limit for `positionFunding`. Vessel's bounded
30-day refresh is not a claim of full lifetime coverage. [3, 12]

## Collateral, identity and credentials

Lighter's RH guide explicitly describes a separate exchange with the same
REST protocol: balances, account indexes and API keys do not carry over. It
also says read-only tokens work as on mainnet. Its RH collateral is USDG with
six decimals; metadata, not the legacy `usdc` spelling in some protocol field
names, determines the currency. [1, 7]

The RH API Keys guide documents
`ro:{account_index}:{single|all}:{expiry_unix}:{random_hex}`. Such tokens
read auth-gated data but cannot place trades or request withdrawals. The
mainnet funding reference explicitly requires authorization for personal
main/subaccounts, with an exception for public pools. RH's reference does not
repeat that prose; protocol parity plus its own header schema support the same
authenticated read, not an anonymous personal-account fallback. [1, 3, 4, 13]

Vessel must still bind `single` to the selected native account index and verify
`all` against that exchange's main/subaccount discovery. The token syntax does
not contain an exchange identifier. Isolation therefore comes from the
existing owner/account/purpose encryption, `lighter-rh-read-token` versus
`lighter-read-token`, the venue guard and the configured exchange client—not
from parsing `ro:` alone. Keep authorization out of URLs, notices and retained
raw JSON. Do not copy the older RH JavaScript SDK's optional query-credential
support into Vessel; the RH OpenAPI and current Python SDK support headers.
[3, 5, 9, 13; existing `venue-credentials.md` and RH contract]

## Payment sign versus execution PnL

The official funding guide states that a positive funding payment credits the
account and a negative one charges it. RH's first-party history path corroborates
the field mapping: the `Pl` normalizer preserves `change`'s sign, the history
table uses it for **Payment**, and the `O` renderer formats that value directly.
Its colour calculation is separate; neither that colour nor position side
should determine the stored sign. `discount` is retained as an original fact,
not added again to the reported payment. [8, 9]

The official PnL guide says funding is immediately applied to **the position's**
realized PnL. The execution schema instead describes `ask_account_pnl` and
`bid_account_pnl` as realized PnL triggered by reducing a position, without
specifying funding inclusion. RH's UI prefers these reported fields; its
price-only fallback when they are absent is not proof of the server fields'
basis. Consequently neither `Included` nor `Excluded` is established for
execution PnL. This is a blocker for claiming a combined execution-plus-funding
net result, **not** for retaining/displaying separate settled payments.
[3, 10, 11]

## Safe verification and tests

Only documentation, official SDK/static web assets and unauthenticated public
schema/metadata reads were used. No owner account, address, credential, database
or migration was accessed. A parameterless GET of both production
`positionFunding` routes returned HTTP 400 with code `20001` and
`"invalid param "`; this confirms route presence only, not an authenticated
happy path. Full parity comes from the published RH schema and first-party
client, not that error response. [3, 9, 14]

`backend/tests/Vessel.Tests/LighterRobinhoodFundingTests.cs` uses synthetic
payments/tokens and the existing public RH catalogue fixture. It covers USDG
and exact signed amounts/IDs, original facts, inactive native contract identity,
cursor exhaustion and exact millisecond filtering, unknown execution funding
basis, foreign/disabled account guards, per-account/exchange credential and
collateral separation, missing/wrong-scope/refused tokens, unknown native
contracts, and token echoes in raw responses. Tests are offline; they do not
prove real token acceptance.

Verification: **11 RH cases passed**, plus **50 mainnet funding cases**, in an
isolated artifact directory. No shared adapter edits were required:

```sh
DOTNET_ROOT=/home/ops/.dotnet /home/ops/.dotnet/dotnet test \
  backend/tests/Vessel.Tests/Vessel.Tests.csproj \
  --artifacts-path /tmp/vessel-rh-funding-build \
  --property:RestoreLockedMode=true \
  --filter 'FullyQualifiedName~LighterRobinhoodFundingTests|FullyQualifiedName~LighterFundingTests' \
  --verbosity minimal
```

**Remaining unknowns:** no authenticated RH payment payload was requested;
filter-boundary behavior and REST retention are not explicitly documented;
execution-PnL funding inclusion is unverified. Ask the venue for an explicit
execution-field definition before changing `PnlBasis`.

## First-party sources

All URLs checked October 16, 2026. Documentation was readable in the public
browser; plain HTTP-client downloads of some ReadMe pages returned 403.

1. Lighter, RH differences:
   https://apidocs.lighter.xyz/docs/lighter-rh
2. RH Get Started, links the RH OpenAPI download:
   https://apidocs.rh.lighter.xyz/docs/get-started
3. RH OpenAPI, `positionFunding`, `PositionFunding`, `PositionFundings`, `Trade`:
   https://apidocs.rh.lighter.xyz/openapi/api.json
4. Mainnet funding-history reference, personal-account authentication:
   https://apidocs.lighter.xyz/reference/positionfunding
5. Official Python SDK request serializer and payment models:
   https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/api/account_api.py
   https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/docs/PositionFunding.md
   https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/docs/PositionFundings.md
6. Robinhood's official Lighter domains page:
   https://docs.robinhood.com/chain/lighter-domains/
7. Public RH collateral metadata:
   https://api.rh.lighter.xyz/api/v1/assetDetails
8. Official funding payment sign:
   https://docs.lighter.xyz/trading/funding
9. RH production client, release `b7cf3f6ce67a831368247c085afd739a8760c4a4`;
   filenames are deployment snapshots, not stable API contracts:
   https://robinhoodchain.lighter.xyz/assets/vendor-zklighter-CF5lIz2f.js
   https://robinhoodchain.lighter.xyz/assets/dist-CqSTwP7I.js
   https://robinhoodchain.lighter.xyz/assets/TradeHistoryTable-Bkx7n93_.js
   https://robinhoodchain.lighter.xyz/assets/Banners-DsYlJHGV.js
10. Official position-PnL semantics:
    https://docs.lighter.xyz/trading/pnl-and-total-account-value
11. Official execution-field descriptions:
    https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/docs/Trade.md
12. RH historical-data guide, including distinct CSV-export limits:
    https://apidocs.rh.lighter.xyz/docs/historical-data
13. RH read-only authentication:
    https://apidocs.rh.lighter.xyz/docs/api-keys
14. Parameterless route probes, no account or authorization:
    https://api.rh.lighter.xyz/api/v1/positionFunding
    https://mainnet.zklighter.elliot.ai/api/v1/positionFunding
