# Activity operations

October 12, 2026. Activity groups retained imported fills into position operations. This is a read-only report, not a Play creation, a thesis, an order link or a retrospective review. Overview shows the latest five operations, Activity adds filters, and account detail shows that account's operations. Every row can expand into constituent executions.

## Round trips

The Application-layer `OperationAggregator` reads only normalized `side`, `positionEffect`, `feeBasis` and `pnlBasis`. Venue direction text is display-only. Fills group by account and canonical contract, then walk chronologically. A signed position starts at zero only when the first fill explicitly opens it. Buy adds quantity and sell subtracts it. An operation begins when position leaves zero and closes when it returns to zero. Partial closes and later increases remain one operation until flat. An operation still holding a position is open.

Quantity means maximum absolute position, not cumulative entry quantity or notional. Total entered, total exited and remaining quantities are separate. Entry and exit prices are quantity-weighted over their respective allocated fills. Distinct nonempty order IDs count once on each side; missing IDs produce a coverage warning and never receive fabricated identities. Fill count counts constituent retained fills in this operation. One flip belongs to both adjacent operations.

Same-side fills sharing a timestamp use database ID as a stable display tie-breaker. Opposing fills sharing a timestamp have no authoritative retained sequence, so they make the remaining walk incomplete rather than using a random ID to invent a round trip.

## Flip allocation

A valid flip must oppose the computed position and exceed its absolute quantity. The closing allocation is exactly the current absolute position. The opening allocation is exactly the fill quantity minus that closing quantity, at the same price and time. The closing operation gets **the full reported fee and closed P&L**, including any net-of-fee amount. The new operation gets zero fee and zero closed P&L from that fill. This attribution avoids a proportional fee division that could repeat indefinitely, and preserves the original reported sum across both operations. It is an allocation convention, not a claim that the opening portion traded without a fee.

`OperationFillDto` keeps the untouched `FillDto` and separate `role`, allocated `quantity`, `fee` and `closedPnlUsd`. Expanded execution rows show the allocation; a separate Original flip facts disclosure shows the original. No fill, order link, account snapshot or Play is modified.

## Exact values and results

All API monetary values, prices and quantities are decimal strings. The aggregator converts retained .NET decimals into signed `BigInteger` coefficients at scale 28. Sums, subtraction, maximum positions and flip splits remain exact even when differing decimal scales would round during normal decimal addition. Price-times-quantity products retain scale 56. Weighted averages round only at the division boundary, to 28 decimal places, halfway away from zero. Nonterminating averages cannot have a finite exact decimal representation. The scope notice names this precision limit.

Reported closed P&L sums allocated venue facts. The P&L basis is gross, net-of-fee or mixed. Net result follows the existing sizing rule: subtract USDC fees on gross fills only. Net-of-fee fills already include their fees, so no fee is subtracted again. A nonzero gross fee in another token makes net result null, with a coverage reason, rather than converting it or claiming a complete result.

The display sums USDC, USDT, USDT0, USDE, USDe and USDH fees as nominal stablecoin units. These are explicit symbol labels from normalized execution facts, not a wallet token-identity validation or FX conversion. All other fee tokens stay in separate exact token totals. A USDT gross fee appears in the nominal stablecoin display but still makes net result unknown, since sizing's USD result supports USDC fees only. Negative reported fees, such as rebates, retain their sign. Unsupported fees on net-of-fee fills do not make net result unknown because that P&L already accounts for them. Separate funding cashflows are not added, and RISEx funding inclusion remains unverified.

The frontend does not total money. Sign colouring examines decimal strings directly; display formatting reuses the existing decimal-string formatter. Exact API values remain available in numeric-cell titles.

## Coverage

Retained imports are not complete lifetime history. `WorkspaceStore.SaveRefreshAsync` appends new fills and deduplicates existing source identities; it does not trim them to the overview route's 100-row display limit. Activity reads all retained facts, on enabled owner accounts only, in one repeatable-read transaction with the latest snapshots and confirmed order links.

A first close or flip lacks its opening position. Unknown effects, opposing open fills, same-side closes, oversize closes without a flip, invalid flip sizes, nonpositive quantities/prices and ambiguous opposing timestamp ties also prevent a trustworthy walk. Once ambiguous, the remainder of that contract's history stays in one incomplete operation. A subsequent opening effect alone cannot prove the unknown prior position was flat. Position-derived direction, opening time, peak/entered/exited/remaining quantities and weighted prices are null. Reported money and original fills remain available, accompanied by the reason. Completed operations before the ambiguity remain intact.

An incomplete operation is not relabelled open or closed from the latest snapshot. For trustworthy walks, the computed signed remaining quantity is compared with the latest snapshot. Missing contract rows in an available snapshot mean zero observed position. Disagreement is a coverage notice on the contract and its latest operation, never a correction. A snapshot-only position also produces a notice. No snapshot means comparison is unavailable; a snapshot older than the last fill is explicitly not comparable. Provider history notices remain visible.

Confirmed order links supply fill Play IDs. Only an operation whose **every** fill links to the same Play gets that Play ID. All-unlinked is Unassigned; multiple Plays or linked/unlinked mixtures are Mixed with a null operation Play ID. Suggested/dismissed links are not assignments. Multiple simultaneous Plays on a contract still form the one venue position operation, and their separate intent remains untouched.

## Endpoint and bounds

Authenticated `GET /api/activity` returns newest-last-fill-first operations, constituent fill allocations, total operation count, retained fill count, omitted operation count, scope note and account/contract coverage. Optional `accountId` scopes reads to one owner account. A foreign or missing account returns 404, a disabled account returns an empty report. Responses use `Cache-Control: no-store` and never cache authorization.

Aggregation happens before response limits. The response includes at most 500 operations and 10,000 allocated fill rows, with at most 200 per operation. Each operation reports omitted fill count; all metrics still include every constituent fill. Constituent rows display chronologically and retain the earliest rows when capped. Operations with no remaining fill-row budget still report their full aggregate and omitted count. The UI shows the loaded and filtered counts, any omitted operations and per-operation omissions. There is no pagination or backfill in this step.

## UI filters and colours

Activity filters loaded operations by enabled account, current portfolio membership including Unassigned accounts, canonical contract, Long/Short, open/closed/incomplete, rolling 7/30/90 days or a custom date range. All retained activity is the default. Date filters use the latest constituent fill timestamp, not only opening time, so an operation opened earlier but active within the period remains visible. Custom dates include both selected UTC calendar days. Filters are client-side and do not expand the endpoint's retained-history or response limits. Reset restores all loaded operations.

Long uses the positive green token and an up arrow; Short uses the negative red token and a down arrow. Fill-level rendering derives position direction from normalized side and open/close effect, never venue wording. A flip's original row displays both directions; unknown effects stay Unknown. Reported P&L and net result colour by sign. All CSS reads appearance tokens; direction badge text sits on the theme's card background, covered by built-in contrast tests. Controls have native labels, table headings and expanders with `aria-expanded`. Loading and failures never fall back to raw overview fills or synthetic operations.
