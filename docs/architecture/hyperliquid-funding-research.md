# Hyperliquid settled user funding

**Research date: 2026-10-16.** Narrow handoff to the venue worker; no implementation or account queries. Sources are official Hyperliquid documentation and its Python SDK, pinned below. **Documented** means explicit contract/text; **observed** means an official example/recorded fixture; **inference** and **recommendation** are not upstream guarantees.

## 1. Request and settled facts

**Documented:** send JSON to `POST https://api.hyperliquid.xyz/info` with `type = "userFunding"`, `user` (42-character hexadecimal account address), required integer `startTime` and optional integer `endTime`. Both bounds are inclusive epoch milliseconds; omitted end defaults to now. The documented request has no coin, dex, cursor or page-size parameter. [API]

**Observed response:** an array of records with integer `time`, string `hash`, and `delta` containing:

| Field | Observed representation |
| --- | --- |
| `type` | `"funding"` |
| `coin` | Native perpetual identity |
| `usdc` | Signed decimal string |
| `szi` | Signed position-size decimal string |
| `fundingRate` | Decimal string |
| `nSamples` | Integer in SDK fixtures; null in current docs |

The SDK method posts that request and returns the response unchanged; it does not paginate. Its return docstring incorrectly describes request-like fields (`user`, `type`, `startTime`, `endTime`) rather than the actual records: follow the API examples and recorded fixtures instead. [SDK] [API] [BOUNDED]

**Recommendation:** retain exact amount strings and provenance; consume reported `delta.usdc`, not a reconstructed payment. Treat `nSamples` as opaque—the cited sources do not define its semantics. `fundingHistory` supplies market rates, not an account's settled payments; `predictedFundings` is also not settlement evidence. [API]

## 2. Sign and settlement currency

**Documented economics:** positive rates make longs pay shorts; negative rates reverse that direction. Funding changes balances hourly and has no exchange collection fee:

> Funding is purely peer-to-peer and no fees are collected on the payments.

[FUND]

**Cross-checked sign conclusion: positive `delta.usdc` is received; negative is paid.** This is an inference from official recordings, not an explicit field-definition sentence: at rate `0.0001`, long AVAX has negative `usdc` and short SOL positive; negative-rate long APE also receives a positive amount. Preserve the reported sign. [UNBOUNDED] [FUND]

**Currency:** the documented native crypto-perpetual design uses USDC collateral; mostly USDT-denominated oracle prices do not turn the settlement into USDT (the docs describe quanto treatment without USDC/USDT conversion). For Vessel's supported primary-perpetual scope, record the payment as **USDC**, not USD, ETH, SOL or the `coin` ticker. `coin` identifies the position's contract, not the transferred asset. [SPEC]

**Recommendation / boundary:** do not extend this currency conclusion to arbitrary builder-deployed collateral merely because its response field is historically named `usdc`. Keep unsupported scopes explicit. Funding already changes the venue balance; never add imported funding to a current balance snapshot again. [FUND]

## 3. Native identity versus canonical aliases

**Documented:** perpetual `coin` uses the name from `meta`. **Observed:** official SDK metadata contains native `kPEPE`; its metadata loader preserves names unchanged. Neither that loader nor `user_funding_history` converts names into `1000…` aliases. [INFO] [META] [SDK]

**Vessel recommendation:** use the existing curated native-to-canonical mapping, e.g. native `kPEPE` → Vessel `1000PEPE`, while retaining the exact native name in source identity/provenance. Do not send the canonical alias upstream or multiply the already-settled USDC amount by 1,000. **Unverified:** the examined sources do not establish a blanket `k`-prefix conversion/multiplier rule; do not invent one for unknown coins. Unknown/retired contracts need an explicit unresolved mapping, not silent reassignment.

## 4. Pagination, ordering and completeness

**Documented general limit:** time-range responses return:

> 500 elements or distinct blocks of data

The official continuation instruction is:

> use the last returned timestamp as the next `startTime` for pagination.

[INFO]

**Observed, not an ordering guarantee:** the SDK unbounded fixture has 218 records across 16 ascending timestamps; its bounded counterpart contains 13 records at one timestamp. Those 13 records are an identical prefix, including hashes, of the unbounded recording. Multiple funding records can therefore share a millisecond. These are historical fixtures, not current retention or completeness tests. [BOUNDED] [UNBOUNDED]

**Not documented in the inspected contract:** a formal oldest-first/tie-break order, whether “elements or distinct blocks” means exactly 500 funding rows, an all-time retention guarantee, an exhaustive flag, or a secondary cursor for a truncated timestamp. Do not borrow the separate fill endpoint's limits as funding limits. [INFO] [API]

**Recommended bounded reader:**

1. Fix the requested inclusive end once. Follow the documented inclusive timestamp overlap and deduplicate; never blindly advance `lastTime + 1`.
2. Validate returned bounds/order and require progress in newly observed identities. Do not silently sort an unexpected response and claim the server's continuation remains safe.
3. On apparent saturation, unexpected ordering or stalled continuation, retry smaller fixed time windows within a bounded request budget. An ambiguous/saturated single-millisecond window cannot be resolved by this API's documented cursor: report partial/unknown coverage.
4. Report the requested window, truncation/errors and unresolved boundaries. A short or empty response is not proof of lifetime exhaustiveness.

These are defensive application policies, not additional Hyperliquid guarantees.

## 5. Hash identity

**Observed:** funding records have a `hash`; all 13 bounded-fixture rows have distinct hashes despite their shared timestamp, and those hashes recur unchanged in the overlapping unbounded recording. [BOUNDED] [UNBOUNDED]

**Unverified:** the funding contract does not promise hash uniqueness, derivation, immutability, or stability across every replay/server revision. Presence of the field is not such a promise. [API]

**Recommendation:** retain the raw hash; use a candidate deduplication key scoped by account, native coin, settlement time and hash. Compare payloads on repeats and surface conflicts. Missing/placeholder hashes or conflicting payloads must not produce a completeness claim. Do not use time alone, canonical aliases alone, or amount/rate as identity; do not present this candidate key as a verified upstream stable-ID guarantee.

### Worker-reported implementation bounds (not independently code-reviewed)

The venue worker reports inclusive millisecond windows of at most 31 days, primary metadata including delisted contracts, and incomplete notices for ignored unknown/non-primary records. Limits are 20 pages, 10,000 raw rows, 4 MiB per response and a 20-second whole-read budget. Pages with at least 500 rows overlap their last timestamp; nonadvancing continuation stops partial. These are **Vessel limits**, not vendor retention/exhaustiveness guarantees. Preserve explicit incomplete coverage when a bound prevents continuation; the documented “distinct blocks” ambiguity remains.

Reported identity is `funding:` plus SHA-256 of `lowerhash:nativecoin:unixms` (72 characters), with the native name always retained as `VenueContractId`. This implements a bounded composite identity, not proof that Hyperliquid hashes are universally stable. Keep account/owner scoping outside that identifier and retain conflicting-payload detection. This note does not modify or verify the separate Funding partial.

## 6. Does fill `closedPnl` include funding?

**Explicit official evidence stops short of answering the API-field question.**

The trading page describes entry price, unrealized P&L and closed P&L as:

> purely frontend components provided for user convenience.

Its closed-P&L formula contains:

> `fee + side * (mark_price - entry_price) * position_size`

and describes an opening trade as:

> only the fee

[PNL]

That page describes entry-price updates from trades, contains no funding term, and says fundamental accounting is margin/balance plus trades. Together with separately settled hourly balance transfers, this **supports the inference that trade closed P&L excludes funding**. It is **not** an explicit statement that the JSON field `userFills[].closedPnl` excludes funding. [PNL] [FUND]

There is also a concrete semantic caution: the official API example has an opening fill with `closedPnl = "0.0"` and nonzero separately reported `fee`, whereas the frontend definition includes a fee term. The SDK merely passes fills through and documents `closedPnl` as a string; it supplies no funding-inclusion calculation. Consequently the frontend formula cannot, by itself, prove the API field's complete accounting basis. [INFO] [SDK]

**Actionable conclusion:** ingest/display settled funding separately, but **do not call `sum(closedPnl) + sum(funding) − fees` verified funding-inclusive net P&L yet**, or alter existing fee treatment based on this note. For the worker's optional result basis, **retain `FundingFacts.Unknown`**: neither `FundingFacts.Excluded` nor `FundingFacts.Included` is justified by the inspected sources. Fee basis does not establish funding basis.

**Remaining blocker:** obtain an official field-specific clarification that API `closedPnl` does or does not incorporate settled funding (including partial closes/flips), or authoritative server calculation source. None was found in the cited documentation/SDK. Until resolved, preserve execution P&L and settled funding as separate components; do not silently combine them and risk double-counting. No account query was performed to substitute empirical correlation for that missing guarantee.

## Primary sources

Official docs accessed 2026-10-16. SDK files pinned to commit `2fdb18f9517675ea03695a0962bd19eece9c83f0`; recorded fixtures are evidence of those recordings only.

[API]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-a-users-funding-history
[INFO]: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
[FUND]: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding
[SPEC]: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications
[PNL]: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/entry-price-and-pnl
[SDK]: https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/2fdb18f9517675ea03695a0962bd19eece9c83f0/hyperliquid/info.py
[BOUNDED]: https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/2fdb18f9517675ea03695a0962bd19eece9c83f0/tests/cassettes/info_test/test_user_funding_history_with_end_time.yaml
[UNBOUNDED]: https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/2fdb18f9517675ea03695a0962bd19eece9c83f0/tests/cassettes/info_test/test_user_funding_history_without_end_time.yaml
[META]: https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/2fdb18f9517675ea03695a0962bd19eece9c83f0/tests/cassettes/info_test/test_get_info.yaml
