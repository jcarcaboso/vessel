# Notification Hub implementation state

October 17, 2026. Implementation authorized the same day, with Sol (Codex) for design discussion and verification, as stacked pull requests. Follows the [plan](notification-hub-plan.md) and the [API contract](notification-hub-api-contract.md).

## Steps

| Step | Scope | State |
|---|---|---|
| N1 | Hub core: tables and migration, `notifications` module and subscription, rules, identity parsing, relevance, run grouping, withdrawal, composer, feed cursor, unread count and reset version, store operations, account disable and deletion, retention, heartbeat | Implemented; tests below |
| N2 | API: head, page, claim, read, read-all, preferences, test event, notification frames on the event stream | Implemented; tests below |
| N3 | Browser: client and guards, two-cursor stream, popups, Notifications page, sidebar badge, Settings section, offline banner | Implemented; tests below |
| N4 | Packaging and documentation: Compose service, module-aware health check, release and end-to-end scripts, development runner, operator and developer docs | Implemented; packaged verification passed |

## Design review

Sol reviewed the first draft before implementation; the findings and the changes they caused are in the plan's [Design review](notification-hub-plan.md#design-review-october-17) section.

## Safety

- Tests use newly created disposable PostgreSQL and RabbitMQ containers and synthetic accounts only.
- The owner's database and the repository `.env` are never read or migrated. The new migration (`20261017180000_NotificationHub`) is applied only by `migrate`.
- No image is published and no installation is deployed by this work.

## Verification

Results are recorded here as each check completes; pending checks are not passing checks.

| Check | Result |
|---|---|
| Backend build (Release, analyzers on) | Passed, no warnings |
| Backend suite, disposable PostgreSQL and RabbitMQ, on `main` at `dd36d98` plus N1, N2 and N4 | 2,834 passed, 1 failed, 5 optional live/S3 skips. The failure was an existing migration test that pinned the exact list of pending migrations; it now pins the next one, and its class passes (10 of 10) |
| Notification tests (hub, content, API, stream) | Included above: 13 PostgreSQL hub tests, 20 content tests, API and stream tests |
| Operator script tests (`scripts/test_*.py`) | 58 passed |
| `docker compose config` | Base file and the TLS, credentials, local and external storage overlays valid; services include `worker-notifications` |

Earlier runs under heavy machine load timed out in three unrelated timing-sensitive tests; they passed in the quiet run above.

Each stacked layer was also built and tested on its own, as CI will. N1 on `main`: 0 warnings, 2,832 passed, 5 optional skips. N1 and N2: 0 warnings, 2,840 passed, 5 optional skips. N3 and N4 do not change the backend.

### Sol verification of the backend

Sol (Codex) verified N1, N2 and N4 adversarially (build with analyzers: 0 warnings; 41 notification tests passed before its additions). It found three defects and proved each with a failing test:

| Finding | Severity | Fix |
|---|---|---|
| Ineligible or detail-only candidates could exhaust a run batch, so an eligible event settled as skipped and its notification was lost | Should-fix | Candidates are paged past rejections and the waking event is always examined; headlines take the budget first and the waking eligible headline is always covered |
| A monitor recovery was announced when any earlier problem had been read, not the latest | Should-fix | The latest problem since the last healthy state must have a read notification |
| Link labels for several Plays used the raw Play title | Nit | The title is cleaned before the label is bounded |

After the fixes the four proving tests and a new overflow test pass with the rest: 46 notification tests passed (17 PostgreSQL hub tests).

### Browser (N3)

Built by a delegated Claude agent from the [API contract](notification-hub-api-contract.md), then integrated here. Subscription health (`subscriptionStatus`, `failedDeliveries`) was added to the preferences response afterwards so Settings can show a lagging subscription and failed deliveries, as the plan describes.

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | Passed, 0 warnings |
| `pnpm test` | 121 files, 2,167 tests passed |
| `pnpm build` | Passed; the Notifications page is its own lazy chunk |
| Backend notification tests after the preferences change | 46 passed |

Known limits: a `play-execution` link opens the Play, not its Execution tab, because the shell cannot select that tab; a link to a deleted Play shows the Plays page's existing "no longer available" message.

### Sol verification round 2 (fixes and browser)

Sol confirmed the three round-1 backend fixes (46 notification tests passed, build with 0 warnings) and found no new backend defect. In the browser it found five should-fix races and focus defects, each proved by a failing test; all are fixed and the six proving tests pass:

| Finding | Fix |
|---|---|
| A claim answering after a read frame or a reset could show a notification that was no longer unread | Claims carry the session's reset generation; answers from an older generation are dropped and notifications known read or withdrawn are skipped |
| Popups of a replaced API stayed visible and could act through the new API | Popups close when the API changes, on disconnect and on unmount; their actions act only for their own session |
| A head read could lower the badge after the stream had delivered a newer frame | A head behind the stream's accepted notification cursor is ignored |
| A page answer from before a notification reset could render after it | A reset aborts the request in flight at once; only the replacement fetch is debounced |
| Focus fell to the page body when a focused Mark as read button disappeared | Focus moves to its row |

Frontend after the fixes: typecheck and lint pass, 121 files and 2,173 tests pass, build passes.

### Sol verification round 3 (browser fixes)

Sol confirmed the five round-2 fixes, including the variants it was asked to probe: a reset while a claim is in flight; disable and re-enable; a failed Mark as read, which suppresses only its own competing popup and leaves the row unread; API replacement during a read or a reconciliation; the reset abort racing the debounce and unmount; and heads across reset versions and epochs. It found four more should-fix defects, each proved by a failing test. All are fixed. Their four tests fail on the previous source and pass now:

| Finding | Fix |
|---|---|
| A head read after a Mark all as read conflict could lower the count below a newer frame of the same reset | `acceptHead` ignores a head the accepted cursor has passed, like the stream does |
| A slow unread-rows answer after a reset could close a popup shown after the request | Only popups shown when the rows were requested, and unchanged since, are reconciled; an answer from an older reset is dropped |
| Reading the last unread row dropped focus to the page body | When the list is gone, the list panel takes focus |
| A save or test request answering after the API was replaced could overwrite the new API's preferences or leave its section busy | Commands, conflicts and the cooldown belong to the API that started them; a late answer from the old one is ignored |

Frontend after the fixes: typecheck and lint pass, 121 files and 2,177 tests pass, build passes.

### Sol verification round 4 (confirmation)

Sol reviewed the four round-3 fixes at `bdd308c` and found no defects and no nits. It checked the busy state, the reload guard and cooldown cleanup in Settings, focus when a row survives, and popup bookkeeping; typecheck, lint, 121 files and 2,177 tests, and the build pass.

### CI: a dispatcher race with account deletion

On the stacked pull requests, `The_hub_racing_disable_or_deletion_neither_deadlocks_nor_leaves_unread_on_a_disabled_account` failed in two of eight CI runs. The cause was a foreign-key violation inserting a receipt for an event that a concurrent account deletion had removed after the dispatcher looked it up. The race is in the shared `EventDispatcher` on `main`, present since account deletion began removing event identities on October 15; the hub test exposed it.

The lookup now takes a key-share lock on the event row (`FOR KEY SHARE OF e`), so deletion waits for an in-flight dispatch, as it already did once the receipt was locked. A deletion that removed the event first makes the lookup find nothing, and the dispatch ends as for any removed event. With 60 rounds per run the test failed four of five runs before the change and none of eight after; it now runs 20 rounds.

Sol verified the change (round 5).

- Both receipt paths now take the lock before inserting.
- When deletion wins, the lookup finds nothing, the dispatch returns `Unknown` (live delivery dead-letters it), and catch-up steps over the hole.
- No new lock-order cycle with account disable or deletion, retention, epoch rotation, subscription provisioning, event appends or the hub's own locks. `OF e` leaves `event_cursors` unlocked, and no code updates event keys.
- 384 event, subscription, monitor and notification tests passed twice, and the racing test passed ten more runs.

The full backend suite with the change: 2,840 passed, 5 optional skips.

Outside this work, Sol's sweep found a pre-existing race: creating a Play while its account is being deleted can fail the Play's account foreign key and return 500 instead of 404 or 409 (`PlayService.CreateAsync` reads the account without the account lock). It is reported, not fixed here.

### Packaged release check

`scripts/verify-release.py --storage s3` on `d2e01c2` (images built from that tree, disposable Compose projects, synthetic data): 174 checks passed, exit 0. Matrix: HTTP 44, TLS 47, image 5, monitor 26, notifications 19, restore 15, security 8, worker 10. The notification checks cover the worker's entrypoint, health after a productive maintenance pass, non-root user, no published port and no key ring; the API's heartbeat report; authentication and no-store on the routes; the opaque cursor; the test request and its cooldown; the stream frame; one claim winning the popup; reading clearing the count; a test request committing while RabbitMQ is stopped and arriving through catch-up; and notifications with their read state surviving a database restore.

### Synthetic captures

Graphite and Paper, desktop and 390 px, from a local preview on an isolated synthetic database: [captures](../design/notifications/README.md).

`docs/app-status.md` is a dated snapshot (October 14, `d17f56a`) that already predates the monitor and S3 storage, so it is not updated piecemeal here.

