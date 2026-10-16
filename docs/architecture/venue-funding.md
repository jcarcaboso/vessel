# Settled venue funding

Owner request, October 16, 2026: retrieve funding from each venue, retain it,
show it and aggregate it into an operation's result. One venue worker covered
each registered integration: Hyperliquid, RISEx, Lighter and Lighter on
Robinhood Chain. This is account history, not public funding-rate observations.

## Retrieved facts

| Venue | Read | Normalized cashflow |
| --- | --- | --- |
| Hyperliquid | `POST /info`, `userFunding` | Preserve `delta.usdc`, USDC, native `delta.coin`; canonical `1000…` aliases keep the native contract. |
| RISEx | `GET /v1/account/funding-payments` | Settled `funding` rows only; negate `funding_payment` (the venue reports positive paid), USDC. Do not import unsettled accruals or dividends as funding. |
| Lighter | `GET /api/v1/positionFunding` | Preserve `change`, USDC. Account-bound verified read-only token, header only. |
| Lighter · Robinhood | Same protocol on its separate host | Preserve `change`, USDG. Separate credentials, accounts, market IDs and catalogue. |

The cited primary-source investigations, including exact limits and remaining
API uncertainties, are:

- [Hyperliquid](hyperliquid-funding-research.md)
- [RISEx](risex-funding-research.md)
- [Lighter](lighter-funding-research.md)
- [Lighter · Robinhood](lighter-rh-funding-research.md)

Positive means received; negative means paid. Rates, position sizes and elapsed
time never manufacture a payment. Adapters preserve native identities and use
strict exact decimal parsing. Unknown markets, page caps, failed authentication
and malformed reads cannot prove a complete empty history.

## Refresh and storage

The existing enabled-account refresh invokes the optional funding-reader port
outside database transactions, under the account's refresh lease. Its requested window is the last
30 days, ending at the snapshot's observation truncated to whole milliseconds,
inclusive at both ends. The adapters widen venue request boundaries where
necessary and locally enforce the exact requested window. Reads remain bounded
by their existing HTTP response/deadline limits and explicit page budgets.
There is no lifetime backfill, separate automatic job or new authorization.
Browser account refresh allows 90 seconds for the sequential bounded history,
funding and order-retention reads plus locking/persistence overhead. Play
checks now use the monitor's asynchronous admission endpoint and retain its
10-second request budget; neither scheduled checks nor Play checks add a funding
read. Funding imports are applied in the monitor's short owner-scoped unit of
work only after revalidating the lease, settings, source and credential revision.

`funding_payments` stores immutable normalized settlement facts, with exact
PostgreSQL `numeric` amounts, source ID, canonical and native instrument,
asset, account/owner and timestamp. A unique owner/account/source key makes
repeated or concurrent refreshes idempotent. Repeated source identities with
different normalized facts cause a conflict and roll back the whole refresh;
they never overwrite retained history. Original adapter JSON is not persisted
or exposed. RISEx native Unix-nanosecond timestamps have a separate nullable
`bigint` column because PostgreSQL timestamps have only microsecond precision;
the API sends that integer as a string, never a JavaScript number.

`account_funding_states` records the latest read and one contiguous verified
coverage window, independently of how many payments were returned. Overlapping
complete windows merge; an unread gap is never bridged. A later disjoint complete
window replaces the coverage window, not the retained payments. **This bounded
first pass can therefore lose the older window's completeness certificate after
a long refresh gap; the settlements remain visible as partial history.** Add
multiple coverage intervals only when that limitation needs removing.

Funding outages do not discard a valid ordinary snapshot/fill refresh.
Previously retained funding facts remain and the failure is explicit. Cancellation
during the funding read saves neither snapshot nor settlements. As in the existing
monitor Refresh path, cancellation during a later optional order read does not
undo already committed public refresh facts. Disabling hides funding with account activity; deleting
an unlinked account removes funding facts/state under the existing explicit
account-delete workflow. Composite owner foreign keys, read filters and save
guards cover both new tables. No credentials or raw provider errors are stored
in funding records.

## Attribution and operation results

Funding is allocated to the account's **native-contract position operation**,
not to a fill, order or Play. It must lie strictly inside the operation's known
opening/closing boundaries (or after opening through the latest retained
observation for an open operation). Position reductions do not prorate a venue
payment that already reports its actual amount.

Every operation sharing an ambiguous boundary is marked uncertain. A settlement
at an opening, close or flip timestamp stays unassigned. Native-nanosecond
settlements sharing a boundary's millisecond bucket are also uncertain:
historical execution imports can have only millisecond precision, so finer
funding timestamps must not invent ordering. Unique legacy native identities
can resolve through fills, snapshots **or funding**; multiple native markets
sharing a canonical key remain uncertain.
Activity list/detail reads and retrospective previews use the same funding-aware
identity resolver, so selecting an operation preserves its constituent grouping.

All sums use `ExactAmount` integer arithmetic. Supported stablecoins pool
nominally 1:1 with no FX/depeg valuation. Other assets stay in the settlement
drill-down and make the nominal aggregate unknown.

The API deliberately distinguishes:

- `netResultUsd`: the existing fee-adjusted **reported execution result**,
  unchanged. It is not a claim that the venue's execution P&L excludes funding.
- `fundingNetUsd`: the exact sum of attributable known settlements. `0` is valid
  for a verified empty window; missing history is `null`, not zero. Partial sums
  are explicitly marked.
- `totalResultUsd`: the combined result, available only with complete attributable
  funding coverage and a verified execution-P&L funding basis. With `excluded`,
  add funding once; with `included`, retain the reported result; with `unknown`,
  return `null`.
- `fundingStatus`, `fundingPnlBasis`, `fundingAsOfUtc` and
  `fundingPaymentCount`: separate coverage and accounting-basis information.

**Current accounting limitation:** none of the inspected first-party execution
field contracts proves whether funding is included. All four adapters therefore
return `FundingFacts.Unknown`. Position-level or frontend P&L formulas are not
proof of an execution field's basis. Settled funding can be retrieved, stored,
shown and summed now, but **a definitive combined operation total remains
unverified for these venue fields**. Do not change a venue to `excluded` or
`included` merely to make the total appear. Shared tests cover both future
verified bases as well as the current unknown case.

Play linking, Review, sizing and Overview realized-summary arithmetic remain
execution-based and unchanged. Funding is not assigned automatically to
concurrent Plays. A position operation and a saved Play are different scopes.

## Activity presentation and bounds

Activity and account detail show a Funding column alongside the preserved
execution net. Expand shows the known funding sum, an independently verified
combined total (or “Unverified”), coverage notices and settlement rows loaded
with the execution detail. Compact Overview operation rows expose the same
information on expand without changing their layout.

Activity also provides an **Unassigned funding** disclosure for settlements
whose operation cannot be determined safely. These rows are account-scope facts,
before operation filters, not invented operations. The page returns at most
100 latest unassigned rows with an omitted count. Expanded operations return at
most 1,000 funding rows, with sums still covering all attributed payments.
There is no new independent funding-history pager in this first pass.

History/version tokens include settlements and funding coverage/basis, so a
funding refresh also invalidates a stale Activity page. Responses remain
authenticated and `no-store`. Amount strings and exact native timestamp strings
remain untouched through API validation and use full-value tooltips. Colours
use the existing positive/negative theme tokens.

## Migration and verification

Migration `20261016174509_FundingPayments` creates the two tables only. It does
not backfill old accounts or rewrite execution P&L. Apply it explicitly through
the existing deployment migration process; the API never migrates at startup.
No migration or deployment to the owner's database is part of this work.

New checks include synthetic HTTP adapter fixtures for all four venue entries,
operation attribution/precision/basis cases, real PostgreSQL deduplication,
conflict rollback, owner isolation, coverage gaps, failure/cancellation and
nanosecond round trips, plus frontend payload and rendered funding checks.
Database verification uses a separately created disposable PostgreSQL container;
authenticated live-venue history was not queried.

### Verified October 16, 2026

- Backend Release build with pinned SDK `10.0.302`: **2,065 passed, 5 skipped,
  0 failed**. Collections ran sequentially against disposable PostgreSQL 18;
  the skipped checks require separate live-venue/S3/CLI opt-ins. Migration
  application, model consistency and the Activity-selected retrospective
  partition regression are included.
- Frontend: **2,002 tests passed across 105 files**, run with
  `pnpm --filter vessel-frontend test --maxWorkers=1 --testTimeout=60000`.
  Typecheck, lint and production build also passed.
- Synthetic browser checks covered Graphite and Paper, exact received/paid
  settlement tooltips, unassigned funding and the unverified total. At 390px,
  the operation table scrolls horizontally without overflowing the page.
  [Committed synthetic captures](../design/venue-funding/README.md) show the
  Activity list and expanded settlements in both themes.
- Two independent Sol reviews completed, including final rechecks with no
  remaining concrete blockers. Review found UUID-dependent interval ordering
  after same-time flips and browser timeouts that missed later order/tick reads.
  Regression tests failed before each fix; intervals now order by closing time
  before UUID, and the full sync/check routes use the budgets documented above.
- Operator-script regressions: **37 passed**. Prototype regressions:
  **76 passed**.
- Broader verification exposed a method-metadata-dependent database-outage
  classifier. A typed missing-configuration exception now preserves generic
  503 handling even when wrapped or thrown from another method; its two new
  regression cases failed before the classifier change and passed afterward.

Preview services, venue workers and the disposable database were stopped after
verification. No owner database migration, deployment or authenticated owner
history read was performed.
