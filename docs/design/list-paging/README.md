# List paging: visual check

October 16, 2026. These captures check the server-paged Activity and Plays lists
from `docs/architecture/list-paging.md` on branch
`t3/activity-pagination-play-limits` at `3175973`. They use the Graphite theme
in headless Chromium at 1512px (desktop) and 390px (mobile). The three
Overview images were retaken at `3175973`. The others were taken at `a606df6`.
The commits in between change only the Activity note and validation logic and
the Overview tab CSS.

The data is synthetic and lives in a throwaway PostgreSQL 18 container with
migrations applied explicitly. There are two portfolios (Swing book, Momentum
desk), five enabled accounts and one disabled account. One enabled account is
unassigned. The accounts span Hyperliquid, RISEx and Lighter and use invented
addresses. The data has 593 fills, giving about 167 Activity operations across
nine instruments, including a 30-fill ENA operation. There are 128 saved Plays
in every status, and 8 of them are on the disabled account. No live venue,
owner data or credential was used. Slow and error states were produced by
delaying or failing API responses in the browser.

## Captures

| File | Shows |
| --- | --- |
| `desktop-activity-page1.png` | Activity page 1 of 7 with the pager; no count note without filters |
| `desktop-activity-fills-expanded.png` | An expanded operation with its 30 lazily loaded executions |
| `desktop-activity-skeleton.png` | First-load skeleton |
| `desktop-activity-changed.png` | Page 2 after Activity changed: the notice is at the top of the view |
| `desktop-plays-closed.png` | Plays, Closed tab with counts and pager |
| `desktop-plays-search.png` | Search "breakout" with per-tab counts |
| `desktop-overview.png` | Overview: scoped Plays tabs and 5 recent operations |
| `desktop-overview-plays-all.png` | Overview Plays, All tab, 5 rows |
| `desktop-account-detail.png` | Account detail with its own pager |
| `mobile-activity.png` | Activity at 390px |
| `mobile-plays-top.png` | Plays tabs, search and list at 390px |
| `mobile-overview-plays.png` | Overview Plays at 390px |

## Fixed since the first check

- The Plays pager uses the shared disabled style: transparent at 0.5 opacity,
  both at rest and while loading.
- After a page change, the Activity changed notice is at the top of the view
  above the rows.
- Overview Plays shows its five rows without an inner scrollbar.
- Overview counts exclude disabled accounts (14/22/51/120). The unscoped Plays
  page keeps all 128.
- The Activity count note appears only when filters narrow the scope, for
  example "25 of 167 operations match the filters."
- The skeleton keeps the table position. Columns land within about 20px of the
  real ones, and the skeleton rows are now close to the real row height.
- Overview Plays tabs wrap without covering the list. At `a606df6`, wrapped
  triggers kept shadcn's full-list height (about 62px each), so the second line
  overlapped the first Play row. At `3175973` the triggers are 31px tall
  (`height: auto`), the list is 71px, and the first row starts 8px below it.
  This was checked on every tab at 1512px and 390px. At 1512px the panel is
  about 425px wide, so "All" still takes a second line on its own: Drafts, In
  progress and Needs review fit on the first line. At 390px the tabs form two
  lines of two.

## Notes

- The account detail panel is titled "Recent executions", but it pages
  operations.
- Inside an expanded operation, fill sides show as Long/Short (buy/sell), so a
  closing sell reads "Short". This comes from `sideDirection`, unchanged on
  this branch.
- Plays on the disabled account appear on the unscoped Plays page without a
  disabled marker. This is allowed by the contract.
- The notice for an unpaged view cut at 200 rows was not exercised. There were
  fewer than 200 Drafts and In progress Plays.

## Also verified

- Focus rings on pager buttons are visible (2px `--ring`).
- A page change dims the previous rows to 0.55 opacity, sets `aria-busy` and
  disables the pager, with no skeleton flash.
- 100 rows per page works, and page 2 shows rows 101–167.
- Retry executions and the 404 "Reload activity" work.
- Tab, page and search survive opening a Play and coming back.
- No page overflows horizontally at 390px.
- There were no console errors or API 4xx/5xx responses other than the
  injected executions 500 and 404.
