# Settled funding: synthetic browser captures

October 16, 2026. These screenshots use the real application and API with an
explicitly migrated, disposable PostgreSQL 18 database. No live venue history,
owner data or venue credential was used.

Captured at feature revision `89ec971`, before integration with the Play monitor
stack. The funding presentation is unchanged; monitor controls are outside
these captures' scope.

The CSS viewport is 1600px wide, with a height of 1000px for the list and 1100px
for the expanded views. T3 saves the captures at 1280px wide. Graphite is the
default theme; the final capture uses Paper.

## Synthetic facts

- One enabled account, visibly named **Synthetic funding · no live account**.
- A closed BTC operation has reported execution P&L of `100`, fees of `1` and
  the unchanged execution net of `99`.
- BTC funding settlements of `+5.25` and `-1.125` give exact funding of `4.125`
  (displayed as `$4.13`; exact amounts remain in tooltips).
- An open ETH short has funding of `-2`.
- A BTC settlement of `-0.75` after the operation closed remains unassigned.
- Funding coverage is complete for the fixture, but execution P&L funding
  inclusion is deliberately `unknown`. **Total incl. funding is Unverified**,
  not a fabricated sum.

## Captures

| File | Shows |
| --- | --- |
| [activity.png](activity.png) | Funding beside the preserved execution net, for open and closed operations. |
| [settlements-graphite.png](settlements-graphite.png) | Expanded executions, received/paid funding, the unverified combined total and unassigned funding. |
| [settlements-paper.png](settlements-paper.png) | The same funding detail in the Paper light theme. |

Browser assertions checked the exact settlement tooltips, the unverified total
and absence of page-level horizontal overflow. The existing 390px check is
recorded in [the funding contract](../../architecture/venue-funding.md).
