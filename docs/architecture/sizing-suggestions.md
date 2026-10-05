# Sizing suggestions

October 5, 2026: the owner asked for position-size suggestions after Mark Minervini's risk management: a success rate from past plays, smaller size after repeated losses and back up only once success returns, a risk-based size, a suggested maximum stop, a minimum target and a leverage. Each is a suggestion the owner accepts with a button; nothing is applied automatically. This replaces the prototype's sizing assistant (removed from the app on October 4) and follows the [project brief](../project-brief.md#suggested-position): suggested and entered sizing stay separate.

These are mechanical estimates from the owner's own settings and record, not investment advice.

## Sources

Researched October 5 from Minervini's posts and summaries of *Trade Like a Stock Market Wizard* and *Think & Trade Like a Champion* (the books themselves were not read):

- Risk about 1.25% of total equity per trade on average, 2.5% at most. Position size follows from the stop: position = risk ÷ stop distance.
- An absolute maximum stop of 10%; average loss much smaller. Rule of thumb: cut losses at half the average gain; a loss larger than the average gain is the "cardinal sin". At least a 2:1 win/loss ratio.
- Batting average (share of winners) matters only together with average gain over average loss.
- After an abnormal losing streak, scale exposure down (his example: 5,000 → 2,000 → 1,000 shares) and pyramid back up only once a few trades work at the smaller size. Get off margin while struggling.

He gives no fixed loss count or recovery threshold; the ladder below is the owner's choice, not his rule.

## Owner decisions

- **Risk per trade**: 1.25% by default, editable per owner from 0.1% to 5%. Above 2.5% the editor warns.
- **Risk reference**: the play's account balance (`balanceUsd`: perps equity plus supported stablecoin wallet, or the wallet alone for unified accounts). Without a balance there is no size suggestion; the other suggestions still show.
- **Exposure ladder**: three consecutive losing plays step size down to 50%; two more consecutive losses step it to 25%. Two winning plays at a reduced level with a positive net result since stepping down step it back up one level.
- **Scope**: the record covers the owner's closed plays on all enabled accounts.

## Track record (backend)

A closed play's outcome comes from its linked fills (entry and exit roles), never from price touches or the plan:

```text
Net result      = Σ venue closed PnL − Σ fees paid in USDC
Entry notional  = Σ entry fill quantity × fill price
Return          = net result ÷ entry notional × 100          (unlevered price-move equivalent)
Stop distance   = Σ_entries share × Σ_stops stopShare × |entry − stop|  ÷  Σ_entries share × entry
Planned risk    = entry notional × stop distance
R multiple      = net result ÷ planned risk
```

Stop distance uses the plan revision in force at the first entry fill (the latest revision created at or before it, else revision 1, else the current plan), with percent stops resolved at that plan's leverage. Stop shares are normalized within each entry, so they need not total 100%. Entries or stops without a price are skipped; with none left, planned risk and R are null. Fees in another token are left out and the outcome says so (`feesComplete: false`).

A play with a net result above zero is a win, below zero a loss and exactly zero a scratch. Scratches count in totals but are neither wins nor losses and do not break streaks.

Statistics use the most recent 20 decided (win or loss) closed plays, ordered by close time:

- Batting average = wins ÷ decided plays.
- Average gain and average loss: mean return of wins and of losses (losses as positive numbers).
- Win/loss ratio = average gain ÷ average loss.
- Break-even reward-to-risk = (1 − batting average) ÷ batting average.
- Average R of wins and losses where planned risk is known.

The ladder walks every decided play from the oldest, so its level reflects the whole history.

## Limits (backend)

```text
Effective risk %   = risk % × exposure level (100%, 50% or 25%)
Max stop distance  = 10% of entry, or half the average gain when that is lower and there are at least 5 wins
Min reward-to-risk = 2, or the break-even ratio when that is higher and there are at least 10 decided plays
Leverage           = at most the venue maximum; no increase over the plan's leverage while exposure is reduced
```

Stop distance is the price move from entry, not the return on margin.

## API

`GET /api/sizing` (owner-scoped):

```json
{
  "settings": { "riskPercent": "1.25" },
  "exposure": { "level": "full|half|quarter", "multiplier": "1", "reason": "…", "lossStreak": 0, "winsSinceStepDown": 0 },
  "record": {
    "closedPlays": 0, "decidedPlays": 0, "window": 20,
    "wins": 0, "losses": 0, "scratches": 0,
    "battingAverage": null, "averageGainPercent": null, "averageLossPercent": null,
    "winLossRatio": null, "breakEvenRewardRisk": null, "averageWinR": null, "averageLossR": null,
    "recent": [{ "playId": "…", "title": "…", "instrument": "BTC", "closedAtUtc": "…", "netResultUsd": "…",
                 "returnPercent": "…", "riskUsd": null, "rMultiple": null, "outcome": "win|loss|scratch", "feesComplete": true }]
  },
  "limits": { "effectiveRiskPercent": "1.25", "maxStopPercent": "10", "minRewardRisk": "2",
              "maxStopSource": "default|averageGain", "minRewardRiskSource": "default|battingAverage" },
  "notice": "…"
}
```

Numbers are invariant decimal strings; unknowns are null. `PUT /api/sizing/settings` takes `{ "riskPercent": "1.5" }` and returns the same document; out-of-range or malformed values are 400.

## Suggestions (frontend)

Computed live from the draft, the account balance and `GET /api/sizing`, in the plays feature beside `sizing.ts`. Each shows as one warning-colour line with an **Accept** button, like the existing over-budget "Use" line, so the locked layout does not move. Accepting changes only the field the line belongs to; changing anything afterwards never reapplies a suggestion.

- **Size**, under the size input: `balance × effective risk % ÷ loss per unit` where loss per unit is `Σ share × Σ stopShare × |entry − stop|`. Accept sets the size in the current unit (margin at the current leverage, or quantity rounded down to venue precision). Shows the risk amount and the exposure level when reduced. Every priced entry needs a priced stop on the right side, otherwise the risk is unbounded and there is no size line. Hidden while the entered size is within 2% of it, and when the margin would exceed the budget the line says so and suggests a leverage instead.
- **Maximum stop**, under each stop row: when the stop is further than the max stop distance from its entry, suggest the price at that distance. Accept sets the stop to that price (percent stops keep their unit).
- **Minimum target**, under each entry's targets: when the entry's planned R:R is below the minimum, suggest the target price that reaches it for the entry's farthest target. Accept sets that target.
- **Leverage**, under the leverage control: the lowest whole leverage that fits the suggested (or entered quantity's) margin in the budget and keeps the estimated liquidation beyond the farthest stop, capped at the venue maximum and, while exposure is reduced, at the current leverage. It shows only when the current leverage is a problem: the margin does not fit, the liquidation sits inside a stop, or exposure is reduced. A working higher leverage is left alone. Without a budget there is no leverage line. Accepting with percent levels goes through the existing leverage dialog.
- **Track record**, a compact line in the position panel: batting average, win/loss ratio and exposure level with its reason in a tooltip; risk % is editable there.

Suggestions only apply to editable plays. Planned plays change through revisions as before.

## Implementation notes

- Backend: `Vessel.Domain/Sizing` (outcomes, record, ladder, limits, settings), `Vessel.Application/Sizing` (service and store port), `SizingStore` and the `SizingSettings` migration (`sizing_settings`, one row per owner, risk 0.1–5 with two decimals).
- Frontend: `api/sizing.ts`, `features/plays/useSizing.ts`, `suggestions.ts` and `Suggestions.tsx`. Suggestions appear in the entry form, so both the sidebar and the expanded entry editor show them; the chart's level popover does not.
- Maximum-stop prices round toward the entry and minimum-target prices away from it (five significant figures), so accepting clears the line.
