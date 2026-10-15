# Play monitor implementation state

October 15, 2026. Implementation authorized with Sol implementation agents, independent Sol verification, a final isolated end-to-end check and stacked pull requests. No notifications or drawing alerts are included.

## Stack

| Layer | Scope | State | Pull request |
|---|---|---|---|
| 1 | Unit of work, transaction regressions, approved plan and W0 evidence | Independently verified | [#43](https://github.com/jcarcaboso/vessel/pull/43) |
| 2 | Event history, durable identity, Wolverine outbox and explicit provisioning | Independently verified, including evidence-upload fix | [#44](https://github.com/jcarcaboso/vessel/pull/44) |
| 3 | Worker, scheduling, read coverage, account admission and deployment | Upstream integration independently verified | [#45](https://github.com/jcarcaboso/vessel/pull/45) |
| 4 | Discrepancies, confirmation, dismissal and closed-Play follow-up | Upstream integration independently verified | [#46](https://github.com/jcarcaboso/vessel/pull/46) |
| 5 | Browser state updates, Check cooldown, monitor visibility and final E2E | Independently reviewed; full-stack and packaged checks passed | [#47](https://github.com/jcarcaboso/vessel/pull/47) |

The stack is based on `main` at `f80e641`, including the P1 diary changes, backend/frontend cleanup, Robinhood support, v0.1.1 packaging defaults and Overview allocation. Each PR depends on the preceding layer. No PR has been merged, no image has been published and no owner installation has been deployed or migrated.

## Safety and verification

- Use newly created disposable PostgreSQL/RabbitMQ resources and synthetic accounts only.
- Never read repository `.env`, connect tests to the owner database or apply migrations to it.
- Preserve owner filters, account and Play locking, exact execution facts, retrospective/manual workflows and theme tokens.
- Record executed commands, results, independent review findings and PR links here as each layer completes. Pending tests are not passing tests.

## Current work

- Sol implementers completed the five layers against [the shared API contract](play-monitor-api-contract.md).
- Independent Sol reviewers reproduced and checked fixes for transaction participation, credential races, rate limits, discrepancy coverage and frontend cancellation.
- The parent integrated the reviewed layers with current upstream changes and completed final browser/E2E verification.

## Verified foundation

An independent Sol reviewed the exact 50-file foundation snapshot, then built it in Release and ran its tests against disposable PostgreSQL. Results: 1,453 passed, two live-venue tests skipped, zero failed; all 15 UoW regressions passed. The build had zero warnings/errors.

Adversarial probes found three admission defects: non-atomic concurrent entry, reuse of a completed nested context and entry during rollback. Each was fixed and retested. The final rollback probe rejected late entry, left no tracked mutations and preserved the original account on the next transaction. The reviewer approved the final snapshot before commit.

No migration or broker dependency is included in this layer. The later worker layer moves venue reads outside database transactions.

After reconciliation with `f738ec2`, implementation and independent review both passed the full Release suite: **1,764 passed, three optional live-venue skips, zero failed**. The suite includes 139 PostgreSQL tests and all 15 UoW regressions. Upstream `IOwned` enforcement, extracted EF configurations, numeric fixes and composition boundaries remain intact.

## Final verification scope

The final checks passed on October 15, 2026. The detailed results follow.

- Build and run the repository tests with an explicitly supplied disposable PostgreSQL connection.
- Run the API and worker against synthetic venue observations with no browser open; prove one account read serves its Plays, a partial fill opens a Play, re-reads do not duplicate events and later exits close it.
- Confirm duplicate commands, concurrent manual/scheduled requests, failed-run cooldown, lease loss, settings/credential changes and account disable cannot apply stale results.
- Confirm incomplete reads cannot prove missing protection or a flat position; verify confirmation, dismissal and continued checks for linked exits after closure.
- Exercise committed-event ordering, SSE reset/reconnect and owner isolation.
- Build the release images and run isolated Compose with explicit EF and messaging provisioning, heartbeat health, private AMQP, loopback management and worker credential-key mounts.
- Stop/restart the broker and test durable recovery. Restore the synthetic database without the old RabbitMQ volume and check that pending work survives.
- Inspect the desktop/mobile UI, Check state, worker-offline state and discrepancy dismissal without changing the approved layout.

## Integration checkpoint, October 15

These layer reviews preceded the final full-stack run.

- Events: independent review confirmed the original three late-callback probes
  now pass. Each business callback and before-commit hook owns a participation;
  event writes require the exact active UoW/DbContext. A final interceptor guard
  initially broke evidence-only uploads. The narrow fix leaves object storage
  outside transactions and requires participation only for event-producing
  mutations. Independent re-review passed the unchanged evidence probe and
  all three late-callback probes, plus 72 focused tests. The corrected old-base
  suite has 1,506 passes and two live
  skips. Before that final two-file fix, upstream integration passed 1,816 tests
  with three live skips.
- Worker: independent review approved the corrected credential replacement and
  reverification fences, typed order-only authentication failures, and durable
  owner/venue Retry-After deadlines. Independent runs passed 168 tests plus
  three custom probes; the expanded implementer suite passed 274. Equal-time
  Refresh preserves ledger values while importing new facts; genuinely newer
  observations fence old runs. Check still requires fresh observations.
  Two real API/worker/PostgreSQL/RabbitMQ host tests pass. Upstream integration
  passed 1,915 tests with three optional live skips. A further independent
  review approved `25de361` and passed 78 focused tests covering owner guards,
  credential forwarding, Robinhood coverage and the combined account-monitor
  migration. The owner/venue budget is in `20261015072425_AccountMonitor`;
  there is no separate budget migration.
- Discrepancies: independent re-review passed 63 tests, including the three
  unchanged adversarial probes. Whole-position targets no longer hide missing
  stops; entry-price changes rearm dismissed drift; account-wide assignment
  coverage includes retrospective Plays and is explicitly bounded. A further
  independent review approved `7f4ac51`: 70 tests passed, including the original
  three adversarial probes and seven upstream ownership-model tests. The
  discrepancy migration adds only its own table and preserves the monitor
  budget in the preceding migration.
- Frontend: upstream reconciliation passed independent typecheck, lint,
  production build and all 1,824 tests across 98 files. Both original
  cancellation probes and four added capability/exact-value probes pass.
  Manual/retrospective workflows, lazy pages and unsaved drafts remain intact.
- Release images started successfully in isolated Compose. Worker heartbeat,
  authenticated event history/SSE, HTTP/TLS transport checks and broker
  stop/restart recovery passed. The first build attempt ran out of disk space;
  a second attempt stopped at the browser prerequisite, before backup/restore.
  These earlier attempts were not final approval; the complete run below
  supersedes them.

Only generated task-owned test output and selected obsolete Vessel build-cache
records were reclaimed after the disk filled. No running service, source
snapshot, evidence log or data volume was deleted. The disposable test database
was restarted after its disk-full failure; Docker assigned it a new loopback
port. Tests continue to use an explicit disposable connection string and
isolated schemas, never the owner's database.

## Final assembled verification

| Check | Result |
|---|---|
| Locked NuGet restore and Release build | Passed; zero warnings and errors |
| Backend suite, disposable PostgreSQL and RabbitMQ | 1,976 passed, zero failed, three optional live-venue skips |
| EF pending-model check | No model changes |
| Frozen pnpm install, typecheck and lint | Passed |
| Frontend suite | 1,835 passed across 100 files |
| Frontend production build | Passed; existing 500 kB chunk-size warning remains |
| Operator Python tests | 25 passed |
| Prototype tests | 76 passed |
| Packaged verification matrix | 134 checks: image 5, HTTP 44, TLS 47, monitor 22, restore 10, secret-log checks 6 |
| Browser smoke | 14 checks passed; zero CSP, console or page errors |

Overview allocation landed on `main` during the final checks. The five layers
were replayed onto `f80e641`, preserving both AGENTS entries. Backend and
deployment files are byte-identical to the tested stack. Frontend checks and
the complete packaged verification were rerun.
The independently reviewed worker/discrepancy commits above correspond to
`e5afc09` and `709cdfd` after this replay; their code is unchanged.

The first packaged rerun hit a browser-harness race: it decoded a newly
mounted evidence image before React had assigned its object URL. The harness
now waits for the `blob:` source before asserting decoding and dimensions;
no product image code or assertion was removed.

The full backend suite includes the real API/worker/PostgreSQL/RabbitMQ tests:
scheduled lifecycle reconciliation without a browser, durable on-demand
commands, cooldown, owner isolation and restart recovery. Synthetic venue
observations keep these checks independent of live accounts.

The packaged run built local API/web images and used fresh Compose projects.
It verified explicit migration/provisioning, worker heartbeat, authenticated
history and SSE through nginx, one event per committed status change, no
duplicate for a stale mutation, and durable delivery after a broker outage.
It then backed up PostgreSQL with a pending event, removed the original
deployment and RabbitMQ volume, restored into fresh volumes and verified
delivery with the **same EventId**. Account/Play records, evidence bytes,
notes/markup and credential-key bytes survived restoration.

Browser monitor states use explicitly labelled UI-only fixtures; they are not
evidence of live venue integration. The backend and transport checks above
exercise the real hosts. Graphite desktop, Paper desktop and 390 px Paper
captures were inspected: Check is explicit and disabled in flight/during
cooldown, exact discrepancy details render, dismissal retains its note and
explains that checks continue, and the mobile page has no horizontal overflow.

Reproduce with `Vessel_TEST_POSTGRES` and `Vessel_TEST_EVENT_RABBIT` pointing
only at disposable services:

```sh
cd backend
dotnet restore Vessel.slnx --locked-mode
dotnet build Vessel.slnx -c Release --no-restore
dotnet test tests/Vessel.Tests -c Release --no-build --no-restore
# Supply a disposable ConnectionStrings__Vessel for design-time tooling.
dotnet ef migrations has-pending-model-changes \
  --project src/Vessel.Persistence --configuration Release --no-build
cd ..
pnpm install --frozen-lockfile
pnpm --filter vessel-frontend typecheck
pnpm --filter vessel-frontend lint
pnpm --filter vessel-frontend test
pnpm --filter vessel-frontend build
python3 -m unittest discover -s scripts -p 'test_*.py'
pnpm test:prototype
# Use an installed Chromium and Playwright module; no dependency install here.
CHROMIUM_PATH=/path/to/chromium \
VESSEL_RELEASE_CAPTURE_DIR=/path/to/captures \
python3 scripts/verify-release.py --browser-module /path/to/playwright-core
```

On the shared verification host, .NET commands ran under
`MSBUILDDISABLENODEREUSE=1 flock --close /tmp/vessel-play-monitor-dotnet.lock`.
The packaged harness removed its own containers, volumes, networks and image
tags after success. No Docker image was pushed.
