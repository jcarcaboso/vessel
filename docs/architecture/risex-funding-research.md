# RISEx settled funding: account history and PnL basis

Checked **October 16, 2026** against RISEx's official reference and an
unauthenticated, synthetic zero-address request. No owner account, database,
credential, authenticated WebSocket or trading endpoint was used.

## Decision

**Exact reported account funding payments are available.** Use the public
`GET /v1/account/funding-payments`, not market funding rates, position size
estimates or an account-equity difference. Import only records explicitly
marked `is_settled: true` and `entry_type: "funding"`. The endpoint also returns
unsettled hourly accruals and dividend adjustments; neither is a settled
funding payment for this integration. [R1]

**Whether execution `realized_pnl` already includes settled funding remains
unverified.** The official fill documentation defines it as the change in the
position's cumulative realized PnL, but does not define whether that accumulator
includes funding. Neither the trade-history schema nor the realized-PnL
history's separate `pnl` and `funding` fields resolves inclusion. A separate
funding endpoint/channel is not evidence of funding-free execution PnL.
Keep `VenueFundingReadResult.PnlBasis = FundingFacts.Unknown`; funding may be
stored and displayed, but **must not be added to RISEx's reported operation
PnL** on this evidence. Existing `ExecutionFacts.PnlNetOfFee` is a fee basis,
not a funding basis. The open question in
[risex-integration.md](risex-integration.md#open-questions-to-verify-with-a-real-account-r18)
is not closed by this work. [R3, R4, R5]

To change that basis, obtain a first-party accounting formula/source or a
verified reconciliation that separates price PnL, trading fees and settled
funding, including opening/increasing, reducing, full-close and flip events.
No such proof was found in the cited official material; no private-account
reconciliation was attempted.

## Verified API contract

The official OpenAPI operation is
`AccountService_GetFundingPaymentHistory`. It declares no authentication
requirement. [R1]

| Item | Contract |
| --- | --- |
| Path | `GET /v1/account/funding-payments` |
| Account | Required hexadecimal account address, sent as `account`; the response echoes `account` |
| Market scope | Omit optional `market_id` to include every native market |
| Time bounds | `start_time` and `end_time`, Unix **nanosecond** decimal strings; otherwise the start defaults to seven days ago |
| Pagination | `page` starts at 1; `limit` defaults to 100 and is capped at 1,000; response has `page` and `has_next_page` |
| Sort | `sorted_by=time` ascending or `-time` descending; default descending |
| Records | `records`, including native `market_id`, `funding_payment`, `position_size`, `block_number`, `block_time`, `tx_hash`, `side`, `funding_rate`, `is_settled`, `funding_rate_8h`, `trade_side` and `entry_type` |
| Settlement | `is_settled: false` denotes hourly accrual, not an on-chain settlement |
| Entry kind | `funding` is a regular funding period; `dividend` is a separate one-off adjustment |
| Settlement time | Settled rows use `block_time` as the block timestamp in Unix nanoseconds; unsettled rows use period-end time |
| Sign | Native positive means **paid**, negative means **received**; negate exactly once for Vessel |
| Units | Human decimal USDC, not 18-decimal fixed-point integers; do not divide by `10^18` |

The history schema documents 18 decimal places for payment amounts. The funding
channel independently identifies the currency as USDC, confirms the same sign,
and expressly corrects an earlier erroneous wei interpretation. Its account
notifications require authentication, so Vessel does **not** subscribe. [R1, R2]

The official funding channel describes settlement when trades touch a market,
including another account's trade. Do not treat settlement timestamps as a
fixed hourly cash-transfer schedule, and do not substitute rate histories.
The position-funding endpoint is a current-position aggregate spanning partial
closes; it is not a list of historical cash payments. [R2, R6]

## Bounds, precision and identity

`RisexReader.Funding.cs` reuses the existing strict JSON parser, bounded HTTP
reader and catalogue. It validates an enabled RISEx account and valid EVM
source; if both address and source exist they must agree. Nothing is inferred
from another venue's source ID.

- The shared sync contract supplies inclusive, exact-millisecond `[from, to]`
  bounds, limited by the reader to at most 31 days. Convert those integer
  millisecond bounds to nanoseconds without a floating-point step. The
  reference does not state start/end inclusivity.
  Request one extra nanosecond on either side (clamp the lower guard to the
  Unix epoch), then filter using the **raw nanoseconds** to preserve the exact
  inclusive window. Reject any settled funding row outside that padded request.
- Preserve original nanoseconds explicitly in `OccurredAtUnixNanoseconds`,
  as well as in `RawJson` and the derived identity. `OccurredAtUtc` is floored
  to PostgreSQL **microseconds** using Unix epoch plus
  `(rawNanoseconds / 1_000) * 10` ticks; it is not rounded or reduced to
  milliseconds. Shared persistence retains the native integer separately,
  so exact operation-boundary comparisons need not depend on retaining JSON.
  For example, `1792144800001234567` remains the exact native instant while
  `OccurredAtUtc` is `2026-10-16T10:00:00.0012340Z`. Two distinct native instants
  within one database microsecond still have distinct source identities.
  A row one nanosecond after the requested end is excluded before timestamp
  truncation, rather than incorrectly pulled into the window.
- Preserve decimal amounts exactly with `StrictJson.Number`; reject inexact,
  exponent, malformed or overflowing values. No funding calculation, price
  conversion, scaling or amount rounding is performed.
- Map through `catalogue.ById`, **not** the active-instrument list. Retired
  contracts keep their native market IDs even when a replacement shares the
  canonical asset. An unknown native market is omitted with partial coverage,
  never guessed from the active symbol.
- The REST record has **no event ID or log index**. The private funding
  WebSocket does have a log index, but that is unavailable in the public
  history contract. [R1, R2]
- Derive a stable, account-scoped source key from the normalized public address,
  native market ID, block number, raw nanosecond time and normalized transaction
  hash, using SHA-256. Do not include amounts, JSON formatting or page ordinals:
  formatting changes must not produce new payments, and a changed amount must
  not silently become another payment.
- **Conservative identity limitation:** if multiple records share those native
  coordinates, reject the read, even if their amounts differ. They might be
  duplicated pagination or multiple real settlements inside one transaction;
  without a native event index we cannot safely discard one or manufacture
  separate identities. Missing/invalid settlement transaction or block facts
  also reject the response.

## Coverage and failure semantics

The reference's page numbers are not a snapshot/cursor guarantee, and no
retention horizon or indexer-finality guarantee is documented. `Complete`
means the fixed requested window was fully traversed as currently returned by
this endpoint, **not** that later indexer corrections are impossible. [R1]

- Read sequential ascending pages through `has_next_page: false`, checking the
  echoed account, exact page number, page size and nondecreasing settlement
  times. A valid empty terminal page verifies an empty window.
- Bound a read to **10 pages / 10,000 upstream rows**, including excluded
  accrual/dividend rows. Hitting the cap while another page exists returns
  `Complete = false`, retains the requested `FromUtc`/`ToUtc`, and reports the
  cap in the notice. Never relabel the retrieved tail as a complete window.
- Unknown native markets also return `Complete = false` with an explicit
  omission notice. Excluded accruals/dividends are always named in the notice.
- Duplicate coordinates, empty nonterminal pages, malformed/oversized
  responses, incompatible row kinds, account/page mismatch, reversed time
  order and ignored time bounds reject the read rather than claiming zero.
- Reuse the shared 20-second overall deadline, 4 MiB response cap, JSON-depth
  limit, recursive duplicate-property rejection and caller cancellation.
  HTTP/parse/deadline failures are safe `VenueReadException`s; caller
  cancellation remains cancellation.

RISEx documents a REST budget of 500 requests per ten seconds per IP. The
reader issues at most ten sequential funding requests plus the existing
catalogue read; it introduces no background polling, retry loop or separate
request budget. [R7]

## Public shape check and synthetic verification

On October 16, 2026 a public zero-address query for October 15–16 UTC with
explicit nanosecond bounds, `page=1`, `limit=1000`, and `sorted_by=time`
returned this shape (request ID omitted):

```json
{"data":{"account":"0x0000000000000000000000000000000000000000","records":[],"page":1,"has_next_page":false}}
```

This verifies endpoint availability and the production response envelope only.
It does **not** verify populated payment identity uniqueness, historic
retention or funding inclusion in execution PnL.

`backend/tests/Vessel.Tests/RisexFundingTests.cs` uses only synthetic HTTP
fixtures. It covers native signs/USDC precision, zero, raw preservation,
exact native nanosecond retention beside microsecond timestamps, the 31-day limit,
inclusive boundaries and one-nanosecond guards, pagination/exhaustion and the
page cap, accrual/dividend exclusion, retired/replacement market identity,
unknown-market coverage, stable identity and duplicate refusal, malformed
money/schema/pagination, duplicate JSON keys, account/source validation,
ordering/bounds, cancellation, unavailable responses and the byte cap.

Verification on October 16, 2026 with the pinned .NET SDK 10.0.302:

```sh
dotnet test backend/tests/Vessel.Tests/Vessel.Tests.csproj \
  --artifacts-path /tmp/vessel-risex-funding-build \
  --filter 'FullyQualifiedName~Risex'
```

Result: **69 passed, 1 skipped**, including **50 passing funding cases**.
The skipped existing live test requires an explicitly supplied public account;
it was not enabled.

## Primary sources

- **[R1]** [Get funding payment history — official OpenAPI](https://developer.rise.trade/reference/accountservice_getfundingpaymenthistory.md)
- **[R2]** [Funding Channel — official account settlement, USDC and sign documentation](https://developer.rise.trade/reference/funding-channel.md)
- **[R3]** [Fills Channel — official realized-PnL accumulator delta definition](https://developer.rise.trade/reference/fills-channel.md)
- **[R4]** [Get account trade history — official execution response schema](https://developer.rise.trade/reference/getaccounttradehistory.md)
- **[R5]** [Get realized PnL — official position-change PnL/funding schema](https://developer.rise.trade/reference/accountservice_getrealizedpnl.md)
- **[R6]** [Get position funding — official current-position aggregate semantics](https://developer.rise.trade/reference/accountservice_getpositionfunding.md)
- **[R7]** [REST and WebSocket API — official time units and rate limits](https://developer.rise.trade/reference/general-information.md)
- Discovery index: [RISEx official `llms.txt`](https://developer.rise.trade/llms.txt)
