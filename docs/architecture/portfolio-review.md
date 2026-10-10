# Portfolio review

October 9, 2026. The owner approved implementation of the
[visual proposal](../design/portfolio-review/README.md) and requested two
independent Sol verifications. Review now follows Plays in the main navigation.
The Play workspace layout is unchanged.

## Scope

Review reports saved, closed Plays from their linked imported execution facts.
It does not assign fills, change lifecycle, sync a venue, invent a trading
thesis or persist a score. No sample results appear in the production page.

There is not yet a confirmed retrospective imported-Play entity or grouping
workflow. Unassigned fills therefore appear in coverage, not as scored Plays.
The proposal's origin filter remains mock-only. This is an explicit limit of
the implementation, not a claim that all imported trading history is reviewed.

All portfolios includes enabled accounts without a portfolio, once each.
Disabled accounts are excluded. Historical grouping follows current portfolio
membership. Asset grouping uses the exact stored contract key: multipliers
are preserved and aliases are not guessed.

## Read contract

Authenticated, owner-scoped `GET /api/review` accepts:

| Parameter | Values |
| --- | --- |
| `period` | `day`, `week`, `month` (default), `year`, `all` |
| `portfolio` | `all` (default), `unassigned`, or portfolio UUID |
| `accountId` | Optional account UUID; intersects the portfolio filter |
| `instrument` | Optional exact contract key, at most 128 characters |
| `offset` | Detail-page offset, default 0, maximum 1,000,000 |

Periods are rolling 24 hours, 7, 30 and 365 days, or all retained results.
The start is exclusive and the report time inclusive. A Play belongs to its
latest linked exit timestamp, not the time a refresh detected closure.
Partial exits on still-open Plays are not part of this report.

The response contains filter options, all five period totals, metrics, chart
points, portfolio/account/asset groups, coverage, and up to 50 contributing
Plays with a `nextOffset`. Every request reads a fresh PostgreSQL repeatable-read
snapshot. Pagination is not a frozen historical session; sync/link edits can
change membership between pages. Unknown or out-of-scope identifiers return
an empty selection rather than another owner's data.

Financial fields are invariant decimal strings. The server calculates totals
and metrics over the full eligible set, not the current detail page. The browser
formats exact strings; floating-point conversions are limited to visual
geometry/sign. Even the displayed chart minimum uses an exact comparison.

This first single-user implementation loads retained closed-Play facts into
memory. There is no silent history cap, but very large histories will need
database-side reporting before the memory/query cost becomes acceptable.
No schema migration, cache, background job or new package is required.

## Eligibility and coverage

A scored Play must have distinct linked fills with:

- Both entry and exit quantities, all positive, with positive prices.
- The Play's account and contract on every fill.
- Entry effects `open`, exit effects `close`, consistent opposing sides.
- Equal entered/exited quantity and no negative running position, grouping
  fills with the same timestamp together.
- No future execution timestamps.
- A usable outcome and complete reported fees.

Review also checks retained linked orders. A fixed-size filled order establishes
a minimum executed quantity equal to its original size. If fewer fills are
retained, the Play is excluded even when
its retained entry/exit subset happens to balance. This also catches executed
linked orders with no retained fills. Cancelled/rejected/triggered/other states
do not establish execution through a size change alone. Dynamic position TP/SL
orders also do not establish this fixed-size bound. A normalized, reliably
reported executed-quantity field would allow checking partially filled cancelled
orders later; the current shared order contract does not have one.

Balanced fills and no known order discrepancy still cannot prove full venue
history. Coverage states that retained history may be bounded. The earliest
retained fill is not a guarantee of continuous coverage. Exclusion counts use
the available exit time, falling back to detected closure when no exit exists.
Open-Play counts describe current state, while unassigned fills are counted
within the selected time and account/asset scope.

## Calculations

| Metric | Rule |
| --- | --- |
| Net P&L | Sum reported closed P&L, subtracting USDC fees only for gross-basis fills. Net-of-fee fills are never charged twice. Nonzero gross fees in unsupported tokens exclude the Play. |
| Win / loss / scratch | Positive / negative / exactly zero net result. |
| Batting average | Wins / (wins + losses). Scratches excluded. |
| Play return | Net P&L / executed entry notional × 100, not return on margin or account equity. |
| Average gain / loss | Mean winning return / absolute mean losing return. Each Play has equal weight. |
| Profit factor | Sum winning P&L / absolute sum losing P&L. |
| Expectancy | Mean net result including scratches; descriptive, not a forecast. |
| Drawdown | Largest drop from a prior peak in cumulative closed-Play P&L, starting at zero in the selected window. Not equity drawdown. |
| Streaks | Consecutive positive/negative outcomes in close-time/Play-ID order. Scratches do not break them. |
| Realized R | Net P&L / an initial planned-risk estimate, only when the plan qualifies below. |
| Reviewed | A saved nonblank written review. Does not establish plan adherence or decision quality. |

Missing denominators are null/N/A, not infinity. Empty performance is null,
distinct from a real zero result. Aggregate batting, payoff and profit factor
pool individual outcomes; they never average group percentages.

Amounts are nominal USD. Separate funding cashflows are not added. Whether
RISEx's reported realized P&L embeds funding remains unverified, so the UI
does not promise funding-free results. Stablecoin FX and transfers are not
part of this calculation.

### Planned-risk estimates

`PlayOutcomeCalculator` extracts the existing sizing arithmetic unchanged.
Review adds a stricter R eligibility check: a plan revision must exist at or
before the first entry, match the executed direction, allocate 100% of entry
shares, and give every entry positive prices and protective-side stops whose
positive shares total 100%. Otherwise R remains unknown.

The estimate still uses executed entry notional multiplied by the plan's
share-weighted stop distance. It is not a reconstruction of actual risk at
each fill. The sizing assistant retains its existing retrospective fallback,
partial-plan estimate and last-20-decided-Play window; Review does not alter it.

### Charts

Daily net results and cumulative P&L use UTC dates. Histories longer than
366 dates use labeled multi-day buckets so every outcome is included in at
most 366 points. Drawdown charts use bucket-closing values and can hide
within-bucket losses; the drawdown metric uses each closed Play. A text table
exposes chart values without pointer interaction.

## Browser behavior and verification

Changing filters aborts superseded requests and hides old metrics until the
new response arrives. Portfolio changes clear the account filter. Removed
portfolio/account/asset options remain visibly unavailable while selected.
Errors do not fall back to mocked data. Definitions and coverage carry the
long explanations; controls retain the compact proposal layout.

Contributing Plays open through the shell's existing saved-Play loader.
Unsaved drafts are preserved, including leverage-only changes and blank entry
structure edits. Closing a dialog aborts a pending open and restores focus.

Regression tests cover service arithmetic, periods, scope, incomplete facts,
fees, risk provenance, bucketing, pagination, authenticated endpoint behavior,
actual PostgreSQL owner isolation/order completeness, API validation, exact
formatting, request races, filters, dialogs and draft-safe navigation.

`scripts/review-smoke.cjs` checks the production UI against an isolated real
API/database. October 9 captures use 525 synthetic closed Plays, never private
account data. The check covers all periods, filters, pagination, charts,
failure/retry, focus restoration and widths 320–1512. Axe reports no violations
at 390 and 1512 pixels. See
[captures and verification receipt](../design/portfolio-review/implementation/).

Both Sol reviewers' findings were addressed: missing known order executions,
initial-risk provenance, funding wording, plan-only draft protection, a removed
asset filter and exact drawdown-caption selection.

Final checks on October 9: 689 backend tests passed against PostgreSQL 18,
with only the opt-in live RISEx test skipped; 483 frontend tests and 76
prototype tests passed. Locked .NET restore, Release build, frontend build,
TypeScript and lint passed. Vite still reports its large-main-chunk warning.
Both Sol reviewers confirmed their findings closed on targeted recheck.
