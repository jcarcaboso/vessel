# Vessel

Vessel is a trading diary for recording decisions, executions, and reflection so a trader can study mistakes and improve their process.

## Language

**Portfolio**:
A collection of brokerage accounts grouped by trading purpose, such as swing trading or intraday trading.

**Account**:
A trader's account at a broker or trading venue, with manually recorded or imported activity.
_Avoid_: User account, portfolio

**Venue**:
The broker or exchange where an account exists, such as Hyperliquid or Quantfury.
_Avoid_: Account

**Play**, provisional:
One trading idea and its history, from the original thesis and intended entries through execution, outcome, and review.
_Avoid_: Entry as a name for the whole idea; plan as a synonym once terminology is agreed

**Plan**:
The intended actions and risk for a play, before or during execution.
_Avoid_: Actual execution

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
