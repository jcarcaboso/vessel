# Vessel

Vessel is a trading diary for recording decisions, executions, and reflection so a trader can study mistakes and improve their process.

## Language

**Portfolio**:
A collection of brokerage accounts grouped by trading purpose, such as swing trading or intraday trading.

**Account**:
A trader's account at a broker or trading venue, with manually recorded or imported activity. Portfolio assignment is optional.
_Avoid_: User account, portfolio

**Unassigned accounts**:
Account records without a portfolio, visible in the all-account view. This is a grouping state rather than another stored portfolio.
_Avoid_: Default portfolio as a separate entity

**Disabled account**:
An account retained for management but excluded from normal imported activity and venue-position views. Enabling it restores retained observations rather than recreating the account.

**Venue**:
The broker or exchange where an account exists, such as Hyperliquid or Quantfury.
_Avoid_: Account

**Play**, provisional:
One trading idea and its history, from the original thesis and intended entries through execution, outcome, and review.
_Avoid_: Entry as a name for the whole idea; plan as a synonym once terminology is agreed

**Plan**:
The intended actions and risk for a play, before or during execution.
_Avoid_: Actual execution

**Play status**:
Where a play stands: Draft, Planned, Paused, Open, Closed or Cancelled. Partial entries and exits are execution progress within Open, not statuses. Review is a separate record.
_Avoid_: Partially in, Executed as a status

**Plan revision**:
An append-only snapshot of a planned play's plan, with the reason it changed. Planning records revision 1.
_Avoid_: Overwriting the original plan

**Order link**:
The association of one venue order with one level of a play: an entry, its stop, one of its targets, or an unplanned exit. Fills reach a play only through linked orders. Links are automatic when unambiguous, suggested otherwise, and remembered when the owner declines them.
_Avoid_: Assigning fills by account and instrument alone

**Execution progress**:
How much of a play's planned entries and exits linked fills have covered. Derived from venue facts, never from price touches.

**Entry**:
One planned tranche of the play's full position, with a share of its total quantity, its own entry price, stop loss, and take-profit targets. An entry is not evidence that a trade occurred.
_Avoid_: Play, fill

**Fill**:
An actual execution of all or part of an entry or exit.
_Avoid_: Planned entry

**Strategy**:
A reusable, testable hypothesis describing conditions under which a trade may make sense. A strategy can be unproven or unsuccessful.

**Strategy version**:
A particular revision of a strategy's reasoning and rules. A historical play refers to the version used at the time.

**Thesis**:
The reasoning for an individual play, including what would invalidate it.
_Avoid_: Strategy when the reasoning applies only to this play

**Review**:
A trader's account of what happened, whether they followed the plan, what changed, and what they learned.
_Avoid_: Result as a substitute for reflection

**Evidence**:
Chart captures, annotations, accompanying free-text notes, and other material that records the context of a decision or review.

**Risk budget**:
The amount the trader chooses to allocate to planned loss at the stops for a play, not a guarantee of maximum actual loss.

**Risk reference**:
The known account value, or an explicitly supplied manual budget when account value is unavailable, used to interpret a target risk percentage.
_Avoid_: Committed margin, guaranteed loss limit

**Entry share**:
The percentage of the full position's quantity assigned to an entry. It is distinct from that entry's share of margin or loss at the stop.
_Avoid_: Risk allocation, margin share

**Planned reward-to-risk**:
The ratio of modeled profit at the planned targets to modeled loss at the planned stops.
_Avoid_: Win probability, realized return

**Suggested position**:
A proposal for the full position's size and leverage derived from entry shares, price levels, desired risk, and available budget.
_Avoid_: Entered position, fill

**Entered position**:
The full position's size and leverage chosen by the trader, with individual entry quantities derived from their shares. It describes intended exposure, not proof of execution.
_Avoid_: Fill, actual execution

**Committed margin**:
The capital assigned to the position's exposure, distinct from its notional value and its planned loss at the stops.
_Avoid_: Risk budget, position notional

**Available budget**:
An optional amount of capital the trader makes available for the play, separate from the amount they choose to commit.
_Avoid_: Committed margin, account value, risk budget

**Stablecoin wallet**:
Supported stablecoin holdings from the venue's wallet ledger, separate from its perpetual-margin snapshot.
_Avoid_: Complete account equity

**Wallet available amount**:
A token's total less its held amount. It is distinct from perpetual free margin and withdrawal capacity.
_Avoid_: Guaranteed tradable collateral, guaranteed withdrawable balance

**Leverage**:
The exposure multiplier relating the full position's notional value to its committed margin. One-times leverage is unlevered exposure.

**Level percentage**:
A stop or target's distance from the entry price, expressed as a percentage of that entry price.
_Avoid_: Leveraged return, return on margin

**Average entry price**:
The planned entry price weighted by entry quantity shares, excluding zero-share entries. The shares define this price even before the trader chooses the full position's size.
_Avoid_: Arithmetic mean of entry prices

**Account value**:
The equity attributed to the selected broker account, separate from an editable play budget.
_Avoid_: Available budget, committed margin

**Portfolio value**:
The combined value of the accounts belonging to the selected portfolio, expressed in a common currency.

**Margin share of portfolio**:
The position's committed margin as a percentage of portfolio value.
_Avoid_: Notional exposure share

**Exposure share of portfolio**:
The position's notional exposure as a percentage of portfolio value. This is distinct from committed capital and can exceed 100%.
_Avoid_: Margin share of portfolio

**Journal owner**:
The person whose private portfolios, accounts, plays, strategies, evidence and notifications belong together.
_Avoid_: Broker account, venue credential

**Instrument**:
A specific tradable market or contract at a venue, with its own identifiers, units and trading constraints. Vessel starts with perpetual contracts for every integrated venue.
_Avoid_: Asset symbol alone when distinguishing contracts or venues

**Venue position**:
The exposure reported by a broker account for an instrument at a particular time. It is distinct from a planned position and from the fills that produced it.
_Avoid_: Play, planned entry, complete execution history

**Concurrent plays**:
Distinct active plays that can share the same broker account and instrument. Their intent and execution associations remain separate from a venue's net position.

**Imported execution**:
A venue-reported fill retained with its source identity and provenance, independently of any thesis or play association.
_Avoid_: Original trading intent

**Retrospective review**:
A trader's analysis added after an execution, which does not claim to be the reasoning documented before the trade.
_Avoid_: Original thesis, pre-trade plan

**Price-level observation**:
Evidence that a specified market-price source reached or crossed a planned entry or exit level. It is not confirmation that an order executed.
_Avoid_: Fill, confirmed TP or SL execution

**Play tracking**:
The monitoring of a play's linked executions and relevant price levels, with the source and certainty of each observation kept distinct.

**Notification**:
A message to the journal owner about a relevant execution, price observation or operational condition. Its delivery is separate from the underlying fact.
