# Lighter mainnet: settled account funding research

**Checked: October 16, 2026. Scope: Lighter mainnet only.**

This research supports the owner's authorized shared settled-funding reader.
Only official documentation, first-party SDK/source and the official deployed web
application were used. No account endpoint was called, no credential was obtained
or used, and no database was accessed. Public documentation and static source
assets were read. This note makes no claim of live authenticated verification.

The adapter is shared through `LighterExchange`, including the separately
configured Robinhood venue. **Do not apply these mainnet conclusions to that
exchange without its separate research**, especially collateral and endpoint
availability.

## Decision summary and unresolved semantics

| Question | Finding / confidence |
| --- | --- |
| Actual account-payment endpoint | **Verified:** `GET /api/v1/positionFunding`, not the market funding-rate endpoints. [1][2] |
| Authentication | **Verified:** main accounts and subaccounts require Authorization; public pools are the documented exception. A scoped read-only `ro:` token can access auth-gated reads. [1][3] |
| Payment sign | **Verified economic convention, supported by UI:** positive is received, negative is paid. The UI displays `change` without negating it. [4][8][9] |
| Timestamp unit | **Strong source evidence for Unix seconds:** SDK example `1640995200`; the actual UI formatter accepts seconds and milliseconds. Parameter prose does not explicitly specify units. [5][8][10] |
| Time-bound inclusivity | **Unresolved:** neither the inspected endpoint docs nor SDK specifies inclusive/exclusive server predicates. Do not describe them as guaranteed inclusive. [1][2] |
| Ordering and cursor snapshot guarantees | **Unresolved:** no documented ascending/descending order, tie-break, snapshot cut, cursor lifetime or completeness/finality guarantee was found. [1][2][6] |
| Trade P&L includes funding? | **Unknown.** Position-level realized P&L explicitly includes funding, but this does not specify the trade fields. Keep execution funding inclusion / `VenueFundingReadResult.PnlBasis` as `FundingFacts.Unknown`. [11][12] |
| Native identity stability | Native `market_id` and `funding_id` exist. Their lifetime uniqueness/non-reuse is **not documented** in the inspected contract. Use their composite within an account, with conflict detection, not a fabricated timestamp identity. [5][13] |
| Mainnet collateral | **USDC is supported by the first-party settlement calculations.** UI formatting says USD, which is not a token identity or a general guarantee for sibling exchanges. [9][11][15] |

### Important P&L evidence tension

The official **PnL And Total Account Value** documentation says funding is applied
immediately to a position's realized P&L. Thus it would be incorrect to assert
that every value called realized P&L on Lighter excludes funding. [11]

Conversely, the current SDK's trade fields are **`ask_account_pnl` and
`bid_account_pnl`**, described as realized P&L triggered by reducing the queried
account's long or short position. The requested names `ask_realized_pnl` and
`bid_realized_pnl` are **not defined in the inspected current Trade schema**.
Neither those descriptions nor the account-level documentation establishes
whether a returned trade amount contains funding, cumulative funding, neither,
or an account-level difference. Do not silently treat the old names as aliases.
[12]

The deployed UI prefers `ask_account_pnl`/`bid_account_pnl` and has a closing-P&L
fallback based on closing quantity times the entry/exit price difference, without
a funding term. The prover also computes funding collateral adjustments
separately from trade `realized_usdc_pnl`. These are useful supporting observations,
**not a field-specific REST serialization guarantee**. They do not resolve
whether the reported trade amounts include funding. [10][15]

**Consequence:** retain settled funding as separate facts. Do not add it to
reported execution/position P&L, subtract it from those amounts, or declare a
funding-exclusive total merely because the payment endpoint is available.
An empty funding page, a zero rate, Standard-account fee assumptions or a passing
synthetic fixture cannot establish the missing P&L basis.

## Verified request and response contract

The SDK defaults to `https://mainnet.zklighter.elliot.ai`. Its generated
`position_funding` method uses `GET /api/v1/positionFunding`. [2][14]

| Input | Inspected contract |
| --- | --- |
| `account_index` | Required int64; one concrete main/subaccount index. |
| `limit` | Required integer, minimum 1, maximum 100. |
| `cursor` | Optional opaque string. |
| `side` | Optional `long`, `short`, `all`; default `all`. |
| `start_timestamp`, `end_timestamp` | Optional int64; inclusivity and units are not explained in the parameter descriptions. |
| `market_ids` | Optional comma-separated IDs. The description calls them int64s, but the item schema says int16; this is a documentation inconsistency, not grounds to truncate IDs. |
| `authorization` | Header; the generated optional parameter does not override the account-type requirement in the human-readable docs. |

Sources: endpoint reference and pinned generated request serializer. [1][2]

`PositionFundings` has required `code` and `position_fundings`, optional `message`
and optional `next_cursor`. The generated Python model accepts `next_cursor=None`,
covering an absent or null cursor. Its list elements have these required fields:
[5][6]

```text
timestamp       integer
market_id       integer
funding_id      integer
change          decimal string
discount        decimal string
rate            decimal string
position_size   decimal string
position_side   "long" | "short"
```

Preserve exact decimal strings; the UI's conversion to JavaScript `Number` is
presentation code, not suitable exact-money storage guidance. No currency,
settled/finalized flag or trade/order ID is present in this payment model.
`discount` is a separate required string with no inspected description explaining
its relationship to `change`; **do not invent an additional credit, subtract it,
or recompute the reported payment from rate and size**. [5][7]

This is the account funding-history endpoint: the UI consumes
`position_fundings` as funding-history rows, while the separate SDK Funding API
exposes market rates. A current or predicted market rate is not a settled account
payment. [8][16]

## Read-only authentication and safe failure

The official API-keys documentation defines:

```text
ro:{account_index}:{single|all}:{expiry_unix}:{random_hex}
```

`single` covers one account index; `all` covers the main account and its
subaccounts. Read-only tokens cannot sign trading/withdrawal transactions and
can access auth-gated data. This is distinct from the SDK example that
pre-generates short-lived API-key-signed auth tokens. Vessel should keep its
existing read-only credential policy, rather than request an API/private key.
[3][17]

The reference explicitly requires Authorization for a main/subaccount funding
read. The generated serializer assigns the provided value directly to the
`authorization` header; it does **not** prepend `Bearer`. The official TypeScript
example likewise sets the raw token in `Authorization`. [1][2][18]

Vessel implementation policy, not a newly claimed venue guarantee:

- Use the saved, owner/account-scoped verified read-only token. Never put it in
  query parameters, logs, stored funding facts or error messages.
- Missing, expired, unavailable or explicitly refused credentials mean **safe
  incomplete funding coverage**, not a successful zero-payment history.
- Mark a credential refused only on an explicit upstream authentication refusal.
  A timeout, 429, transport failure, malformed body or other unclassified failure
  is not evidence of refusal.
- Retain prior facts on failure and return safe, actionable coverage notices.

These preserve the repository's `lighter-delivery-contract.md` and
`venue-credentials.md`; they were not tested against a private account here.

## Sign, timestamp and pagination evidence

### Signed changes and settlement currency

The funding documentation gives the economic payment as negative signed position
times index price times funding rate, and states that positive funding credits
the account while negative funding charges it. Positive rates make longs pay
shorts; negative rates reverse that flow. Payments occur hourly. [4]

The UI follows this convention without changing the amount:

- `TradeHistoryTable-CFCgWFK0.js` queries funding history and maps each row using
  the `Pl` export from `dist-CqSTwP7I.js`. That export is `Vf`, which numerically
  converts `change`, `rate` and `position_size`, without changing their signs.
- Its Payment column uses `fe`, imported as `O` from
  `Banners-DPTKhgtu.js`. The final export maps `O` to `Dg`. `Dg` formats
  `funding.change` directly as USD currency. Colour comes from rate and side:
  negative-rate longs / positive-rate shorts are receiving; the reverse are
  paying. It does not negate or take the absolute value of `change`. [8][9][10]

Therefore the importer should retain signed `change` as received-positive /
paid-negative, not derive payment polarity from `position_side` alone.
The first-party prover applies funding to USDC collateral / allocated margin;
the P&L documentation also expresses collateral changes in USDC. Keep this
mainnet USDC scope explicit instead of equating the UI label USD with a different
asset or revaluing other collateral. [11][15]

### Exact date trace: beware shadowed minified names

The SDK OpenAPI example for `PositionFunding.timestamp` is `1640995200`, a Unix
seconds-sized value. [5] The funding table passes its unchanged timestamp into
a local date formatter, but **the local `v` shadows the module's imported `v`**:

```text
funding component: local v = _()
_ is imported from dist as S
dist final export: $V as S
$V builds new Date(eH(t))
eH(t): t < 0xe8d4a51000 ? t * 1e3 : t
```

The threshold is `10^12`; this formatter accepts both second- and
millisecond-sized values. Following the imported `Ua as v` instead produces the
wrong function. The formatter and seconds example support parsing this endpoint
as Unix seconds, but the formatter alone does not prove an exclusive wire unit.
The example is present in the pinned schema/model documentation. [5][8][10]

### Bounded import policy, not undocumented API guarantees

The UI uses cursor pagination with page size 20, supplies the previous
`next_cursor` to the next request and flattens the returned pages without a local
sort. That demonstrates cursor use, **not** the server's sort or snapshot
guarantees. [8]

For the caller's exact, inclusive millisecond window `[startMs, endMs]`, the
parent's bounded reader policy is:

1. Request `limit=100`, `side=all`, with at most **five pages**. The maximum 100
   is the venue contract; five pages is a Vessel safety budget, not a venue
   history limit.
2. Widen the request bounds by one second, for example
   `start_timestamp=max(0,floor(startMs/1000)-1)` and
   `end_timestamp=floor(endMs/1000)+1`.
3. Convert each reported seconds timestamp to milliseconds and retain only
   `startMs <= timestampMs <= endMs`. Thus local inclusion is exact even though
   the server's inclusion rule is unknown.
4. Follow opaque cursors without assuming timestamp order or stopping just
   because a row is outside the requested local window. Do not synthesize a
   cursor or advance by the last timestamp; multiple markets can share an hour.
5. A continuing cursor after the fifth page, repeated/non-advancing cursors,
   malformed records or a failed page means incomplete coverage. Exhausting a
   cursor means traversal ended according to this API response, not proof of
   an immutable global settlement snapshot.

The widening/filtering rule is a defensive client design, **not verification of
the server predicate**. It does not prove retention length, finality or
race-free pagination. [1][2][6]

The implementation is `LighterReader.Funding.cs`; it uses the existing bounded
HTTP helper, scoped credential reader, token binding and per-exchange request
client. The original ordinary account reader is unchanged. Missing/refused tokens,
malformed pages, an outage and a page-budget ceiling return incomplete funding
without discarding an already valid ordinary snapshot/history refresh. Token
expiry detected locally is not recorded as an upstream refusal. Null, absent or
empty terminal cursors confirm traversal exhaustion, including an empty window;
a short page alone does not.

Synthetic tests in `LighterFundingTests.cs` cover exact signed changes, native
IDs, inactive markets, inclusive/subsecond windows, cursor traversal and budget,
page-atomic malformed/conflicting facts, scope/auth guards, cancellation and no
token in URLs, notices, raw facts or configured HTTP logs. They use no private
account, live database or migrations and do not establish token acceptance or
settlement-finality guarantees.

## Native identities and inactive / unknown markets

Keep funding separate from executions. Within one stored account, use the
parent's source ID **`<market_id>:<funding_id>`**, preserving both native integer
identities exactly. The complete storage namespace must also distinguish venue
and concrete source account. Neither account index nor funding ID should pass
through a floating-point identity conversion. This composite is an implementation
choice supported by the two native fields; the inspected sources do not promise
global funding-ID uniqueness, permanent market-ID non-reuse or event immutability.
Conflicting facts for one source ID must not silently overwrite one another.
[5]

The official OrderBook model distinguishes `perp` / `spot` and `active` /
`inactive`, and includes native `market_id`, `symbol`, quote/base identities and
creation metadata. An instrument's trading status is not the identity of its
historical funding. Retain inactive perpetual catalogue entries for resolution;
do not restrict historic payment reads to currently active instruments. [13]

The UI itself filters funding rows through its market maps; it can omit rows
that do not resolve to those maps. **That is not evidence that an importer may
discard unknown/retired history.** An unknown market or a spot market in a
funding response must cause explicit incomplete coverage rather than silently
dropping the row and reporting completeness. A missing catalogue match does not
authorize inventing a symbol, substituting a currently active contract, or
assuming retirement/reuse semantics. [8][13]

## Source register

All sources accessed October 16, 2026. Python SDK citations are pinned to
`5825eb19867a4dbdd47c02642dc1eec30c30ca73` (October 14, 2026);
TypeScript source to `e19745a9bfbb74cd706f0cf69b2aa66d8c878c2c`
(October 6, 2026); prover source to
`16c0f36d75f2306ee242e26e507e4c237f7f4074` (October 12, 2026).
Documentation and deployed UI asset URLs are first-party but not immutable
published contracts. The endpoint docs were inspected in the collaborative
browser after plain HTTP-client retrieval received 403; no interactive API
request was submitted.

1. Official account funding endpoint and account-type authentication requirement:
   <https://apidocs.lighter.xyz/reference/positionfunding>
2. Pinned Python AccountApi, `position_funding` and request serializer, lines
   4922–5295:
   <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/api/account_api.py#L4922-L5295>
3. Official API keys, Authentication / Read-only Authentication:
   <https://apidocs.lighter.xyz/docs/api-keys#read-only-authentication>
4. Official funding economics, hourly payments and Funding Payment sign:
   <https://docs.lighter.xyz/trading/funding>
5. Pinned payment model and schema/example:
   <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/models/position_funding.py>
   and
   <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/openapi.json>
6. Pinned response model / optional cursor:
   <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/models/position_fundings.py>
7. Readable first-party payment conversion, `convertPositionFunding`:
   <https://github.com/elliottech/lighter-ts/blob/e19745a9bfbb74cd706f0cf69b2aa66d8c878c2c/src/utils/restApiConversion.ts>
8. Official deployed funding table, pagination, columns and market-map filtering:
   <https://app.lighter.xyz/assets/TradeHistoryTable-CFCgWFK0.js>
9. Official deployed Payment cell (`Dg`, exported as `O`):
   <https://app.lighter.xyz/assets/Banners-DPTKhgtu.js>
10. Official deployed shared code: final exports, `Vf`, `$V` / `eH`, closing-P&L
    logic:
    <https://app.lighter.xyz/assets/dist-CqSTwP7I.js>
11. Official position realized P&L / funding inclusion and USDC collateral:
    <https://docs.lighter.xyz/trading/pnl-and-total-account-value>
12. Pinned current Trade schema, especially lines 54–55:
    <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/models/trade.py#L29-L80>
13. Pinned native market identities and inactive/perp/spot statuses:
    <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/models/order_book.py>
14. Pinned mainnet SDK base URL:
    <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/configuration.py#L99>
15. First-party prover: funding collateral adjustment and separate trade
    realized-P&L calculation, not the REST serializer:
    <https://github.com/elliottech/lighter-prover/blob/16c0f36d75f2306ee242e26e507e4c237f7f4074/circuit/src/apply_trade.rs#L254-L374>
    and
    <https://github.com/elliottech/lighter-prover/blob/16c0f36d75f2306ee242e26e507e4c237f7f4074/circuit/src/apply_trade.rs#L766-L796>;
    signed funding delta:
    <https://github.com/elliottech/lighter-prover/blob/16c0f36d75f2306ee242e26e507e4c237f7f4074/circuit/src/liquidation.rs#L26-L57>
16. Pinned separate market Funding API:
    <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/docs/FundingApi.md>
17. First-party API-key-signed pre-generation example, distinct from `ro:` tokens:
    <https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/examples/read-only-auth/README.md>
18. First-party raw Authorization header example:
    <https://github.com/elliottech/lighter-ts/blob/e19745a9bfbb74cd706f0cf69b2aa66d8c878c2c/examples/react/src/utils/middlewares.ts>

For reproducibility of the minified-symbol traces, the retrieved UTF-8 static
assets had these SHA-256 values:

```text
TradeHistoryTable-CFCgWFK0.js
2c8a9103337c3a9b1ab0982a8239c02e95c4e560c71ab78f707f20564e131419
Banners-DPTKhgtu.js
1066fb5ee3e6b33916462f7c7373f955e32f24f4a9d4428f73f1c2b4f07d93b0
dist-CqSTwP7I.js
0b09cdcd4ed28f9aa4be5948c58deedf4166929860942b5690d2ad4ff67e85a0
```

No contradictory field-specific trade-funding guarantee was found. The remaining
trade P&L basis, server bound inclusivity, order/snapshot guarantees and permanent
identity guarantees remain explicitly unresolved rather than inferred.
