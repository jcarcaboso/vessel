# Backend audit, October 13, 2026

Reviewed commit `7559248f838068faff8cf8146844a031bc2a67c9`.

Scope: saved Play lifecycle, execution matching and linking, outcome and R calculations, Review, Activity, sync retention, and sizing. This is a review, not authorization to change the product.

Five remaining defects reproduced in isolated application-code probes. Three are P1 because they automatically misstate executed exposure or finality; two are P2 correction/editing defects. Review rejects the bad execution sets demonstrated below. That protection does not prevent lifecycle corruption or sizing from consuming a false closed outcome.

| ID | Severity | Finding |
| --- | --- | --- |
| B1 | P1 | Known missing entry executions can produce a permanently Closed Play with quantity still open |
| B2 | P1 | A matching planned target can consume an exit that happened before the Play entered |
| B3 | P1 | Linking and lifecycle trust the assigned role even when fills prove the opposite effect |
| B4 | P2 | A closed Play accepts unlinking, then rejects the corresponding repair |
| B5 | P2 | Changing a filled Play's direction changes matching for its existing exposure |

## Method and limits

- Read the repository instructions, ponytail and unslop skills, the previous `trader-review.md`, relevant architecture contracts, application/domain implementations, persistence callers, endpoint handlers, and existing tests.
- Compiled the checkout's Domain and Application source directly into a disposable .NET console project. Used synthetic accounts, orders, fills, revisions, in-memory store implementations, and a fixed clock. No copied implementations of the matcher, lifecycle, outcome calculator, Review, sizing, or Activity were substituted.
- Called the private reconciliation routine through reflection to avoid account sync and venue requests. Other probes called public application services. Persistence behavior was traced in source, not exercised against PostgreSQL. The B1 Review probe supplied the incomplete-order flag that `ReviewStore` derives from the stated inputs.
- Ran no repository test suite, browser QA, service, migration, live venue call, or database access. Read no `.env`, credentials, or owner financial records.
- The prior October 2 claims that Plays cannot be saved, linked, or measured are obsolete. They are not repeated as findings.

Disposable probe:

```text
/tmp/vessel-backend-audit-7559248-FznS1g/probe.csproj
/tmp/vessel-backend-audit-7559248-FznS1g/Program.cs
/tmp/vessel-backend-audit-7559248-FznS1g/output.txt
```

Re-run without starting services:

```sh
dotnet run --project /tmp/vessel-backend-audit-7559248-FznS1g/probe.csproj
```

These are application-level reproductions, not claims of a successful HTTP or database integration test. Test references below identify inspected coverage, not tests run by this audit.

## B1. Known missing executions can finalize a partial close

Severity: P1. Confirmed by the application probe and persistence-path inspection.

Locations:

- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:238-256` sums retained entry/exit quantities and closes when exits cover entries and no entry order has status `open`.
- `backend/src/Vessel.Persistence/ExecutionStore.cs:14-16` excludes Closed Plays from later reconciliation.
- `backend/src/Vessel.Persistence/ReviewStore.cs:22-33` already detects fixed-size filled orders whose retained executions are missing.
- `backend/src/Vessel.Application/Plays/PlayOutcomeCalculator.cs:18-32` and `backend/src/Vessel.Application/Sizing/SizingService.cs:41-51` accept the resulting Closed outcome without that completeness check.

Reproduction:

1. Plan a long BTC Play with entry 100, stop 95 and target 110.
2. Import entry order `in`, status `filled`, original quantity 2, remaining quantity 0. Retain only one opening fill of quantity 1 at 100.
3. Import target order `out`, status `filled`, with a closing fill of quantity 1 at 110 and reported gross P&L 10. Both fees are zero.
4. Reconcile.
5. Later import the missing entry execution under a distinct source-fill ID, quantity 1 at 100 on order `in`. Reconcile again.

Expected: the known missing execution prevents final closure. Once it arrives, the Play remains Open with entered quantity 2, exited quantity 1, and remaining quantity 1. A known incomplete result must not become a decided sizing outcome.

Actual:

```text
Before late fill: status=closed, entered=1, exited=1, open=0
After late fill:  status=closed, entered=2, exited=1, open=1
Review count=0, incomplete executions=1
Sizing wins=1, net=10; planned risk changes from 5 to 10
```

Sync retains the late fill, but the Play is already terminal and no longer reconciles. The false win remains in the sizing record. The risk change here follows additional imported entry notional; it is not evidence that a later stop revision overwrote the original stop.

Existing coverage: `backend/tests/Vessel.Tests/ExecutionTests.cs:175-206` actually supplies fixed-size filled orders of quantity 1 with only 0.5 retained entry and exit fills, then asserts Closed. In contrast, `backend/tests/Vessel.Tests/ReviewTests.cs:324-344` rejects the equivalent known-incomplete report. This is an inconsistency between lifecycle and the later reporting guard, not an absent Review protection.

Minimal fix idea: reuse the fixed-size filled-order completeness check before finalizing lifecycle and before admitting an outcome to sizing. Do not infer executions from cancelled-order remaining size. Keep the Play active with explicit incomplete-execution coverage until available facts support closure.

Acceptance test: reproduce both refreshes above; assert no Closed transition, no decided sizing outcome, and one unit still open after backfill. Also cover a completely missing linked entry order's fills. Preserve ordinary partial closes and closure after the final complete exit.

## B2. Planned exits bypass the pre-entry execution check

Severity: P1. Confirmed by the reconciliation probe.

Locations:

- `backend/src/Vessel.Application/Plays/Execution/ExecutionMatcher.cs:57-73` accepts planned levels using Play creation time, side, price and order kind.
- `backend/src/Vessel.Application/Plays/Execution/ExecutionMatcher.cs:75-80` applies the first-entry time check only to the unplanned-exit fallback.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:246-256` ignores execution ordering when deciding closure.

Reproduction, all times UTC:

| Time on October 10 | Fact |
| --- | --- |
| 10:00 | Create and plan long BTC, entry 100, stop 95, target 110 |
| 10:01 | Place sell order `old-close` at 110 for an earlier position |
| 10:02 | `old-close` fills quantity 1, effect `close`, reported P&L 10 |
| 10:03 | Place buy order `in` at 100 |
| 10:04 | `in` fills quantity 1, effect `open` |

Both orders are filled, original quantities are 1, and fees are zero. Reconcile the batch.

Expected: the earlier closing execution cannot exit this Play's later opening execution. The Play should remain Open with quantity 1, and the earlier fill must not enter its result.

Actual: both orders link automatically, as Target and Entry. The Play transitions Planned → Open → Closed in the same reconciliation. Sizing counts a 10-unit win and 2R. Review rejects it because its running position goes negative before entry.

Existing coverage: `backend/tests/Vessel.Tests/ExecutionTests.cs:110-123` protects an **unplanned** exit at 103. That does not exercise the same earlier exit at the planned target price of 110. `backend/src/Vessel.Application/Review/ReviewService.cs:121-125` contains the reporting-side chronology check that catches this case.

Minimal fix idea: prevent planned exit fills from contributing before linked entry exposure exists. Use execution chronology, not a blanket ban on placing exit orders before entry, since legitimate attached stops and targets may be placed in advance.

Acceptance test: the timeline above leaves one unit open and excludes `old-close` from the Play outcome. A target placed before entry but executed after entry must still work. Test an equivalent stop and an exit belonging to another concurrent Play.

## B3. Assigned roles can contradict normalized fill facts

Severity: P1. Confirmed through automatic reconciliation and the public linking service.

Locations:

- `backend/src/Vessel.Application/Plays/Execution/ExecutionMatcher.cs:65-73` checks entry order flags but not whether its executions open exposure.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:115-130` validates manual order account/instrument ownership and link exclusivity, but not side/effect compatibility.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:246-256` treats every fill on an Entry link as entered quantity and every other linked fill as exited quantity.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:76-78` clamps over-exit open quantity to zero.

Reproduction A, automatic:

1. Plan long BTC at 100 on an account with an earlier short position.
2. Import a non-reduce-only buy order at 100. Its fill is buy 1 at 100 with normalized effect `close`, closing that earlier short.
3. Reconcile.

Expected: closing a short does not prove a new long entry. Keep this execution outside the long Play's entered quantity.

Actual: it links automatically as Entry and opens the long Play with reported open quantity 1, although the fill only closed prior exposure.

Reproduction B, owner link:

1. Open a long Play with buy/open quantity 1 at 100.
2. Import another buy/open of quantity 1 at 102 on order `increase`.
3. Submit `{"orderId":"increase","role":"exit"}` to `POST /api/plays/{id}/execution/links`.

Expected: reject the incompatible role without changing links or status.

Actual: the service accepts it, reports entered 1, exited 1, open 0, and closes the Play. Actual signed exposure from these fills is long 2. Review excludes the Play; sizing records a zero-result scratch with the zero-fee probe inputs.

Caller check: `backend/src/Vessel.Api/PlayEndpoints.cs:28-31` delegates directly to these services. `frontend/src/features/plays/ExecutionPanel.tsx:79-91` offers a manual role selector without filtering out the incompatible direction. This is not just an internal method that no caller reaches.

Existing coverage: `backend/tests/Vessel.Tests/ExecutionTests.cs:218-238` tests ambiguity and exclusive order ownership; `backend/tests/Vessel.Tests/ExecutionTests.cs:242-261` tests stop-level identity. Neither establishes execution-effect compatibility. Review separately rejects wrong effects and sides at `backend/src/Vessel.Application/Review/ReviewService.cs:108-125`.

Minimal fix idea: validate known normalized side/effect against the requested role in both matching and owner linking, then validate it again before a lifecycle transition. Manual confirmation can resolve ownership ambiguity, not reverse an execution's meaning. Do not treat an unsplit flip or an over-exit as proof of exactly flat Play exposure.

Acceptance test: both examples leave lifecycle unchanged and contribute no invented entry/exit quantity. Add a sell/flip of 2 against a long entry of 1, and an exit exceeding this Play's quantity while another Play shares the instrument. Preserve supported same-instrument concurrent Plays rather than imposing uniqueness.

## B4. Closed Plays can lose links but cannot repair them

Severity: P2. Confirmed through the public unlink/link application services. Direct API or stale-client path; the normal Closed UI hides the unlink control.

Locations:

- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:139-149` dismisses a link without checking terminal status or reconciling lifecycle.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:100-101` refuses subsequent linking unless the Play is Planned, Paused or Open.
- `backend/src/Vessel.Api/PlayEndpoints.cs:30-31` exposes that deletion without another guard.
- `backend/src/Vessel.Domain/Plays/Play.cs:139-155` provides no correction transition out of Closed.

Reproduction:

1. Close a Play normally with entry 1 at 100 and exit 1 at 110, P&L 10 and zero fees.
2. Delete its exit link through `DELETE /api/plays/{id}/execution/links/{linkId}`.
3. Try to restore that order as an exit using the link endpoint.

Expected: under the existing final-status policy, reject terminal unlinking atomically. Alternatively, a separately authorized correction workflow would have to update links, status and reporting together.

Actual: deletion succeeds. The Play remains Closed but reports entered 1, exited 0, open 1. Review removes its result; sizing turns the former win into a zero-result scratch. Restoring the link fails with 409, `"Only planned, paused or open plays link orders."`

Existing coverage: the unlink test at `backend/tests/Vessel.Tests/ExecutionTests.cs:234-238` uses a nonterminal Play. The UI's `editable` guard at `frontend/src/features/plays/ExecutionPanel.tsx:71-72` does not enforce the backend invariant or protect a request submitted from a previously open view.

Minimal fix idea: reject terminal link deletion and recheck current status while holding the existing execution lock. Do not add a reopening feature merely to fix the missing guard.

Acceptance test: deleting an Entry or exit link from a Closed Play returns 409, preserves the link and leaves Review/sizing unchanged. Include closure occurring before a pending unlink acquires the lock. Nonterminal unlinking must still retain its remembered dismissal.

## B5. A direction revision can strand real exits

Severity: P2. Confirmed through `PlayService.UpdateAsync` followed by reconciliation.

Locations:

- `backend/src/Vessel.Application/Plays/PlayService.cs:38-53` accepts and stores a normalized revised plan.
- `backend/src/Vessel.Application/Plays/PlayService.cs:119-131` protects filled entry IDs, prices and shares, but not direction.
- `backend/src/Vessel.Application/Plays/Execution/ExecutionMatcher.cs:28-44` derives entry/exit sides from the current plan direction.
- `backend/src/Vessel.Application/Plays/Execution/PlayExecutionService.cs:196-210` matches retained orders against that current plan.

Reproduction:

1. Open long BTC with buy/open quantity 1 at 100.
2. Save a revision with direction `short`, stop 105 and target 90. Preserve the filled entry's ID, price 100 and share 100. Supply the expected version and a nonblank revision reason.
3. Import the actual long exit, sell/close quantity 1 at 110.
4. Reconcile.

Expected: an edit must not change which side closes already executed exposure. Reject the direction change once entry fills exist, or derive matching for that exposure from its executed direction.

Actual: the update succeeds. The plan now expects buy-side exits, so the real sell-side exit remains unlinked. The Play remains Open with quantity 1 despite its complete long round trip.

The revision must also move stops and targets to valid short-side prices. Merely flipping direction while keeping a long stop at 95 is correctly rejected by plan validation and is not this reproduction.

Caller/test check: `frontend/src/features/plays/PlayWorkspace.tsx:190-191` leaves direction editable for Open Plays. `backend/tests/Vessel.Tests/ExecutionTests.cs:287-302` protects filled prices and permits stop revisions, but does not test direction changes.

Minimal fix idea: extend the existing filled-entry revision guard to preserve direction once execution has begun. Require a new Play for the opposite thesis.

Acceptance test: a validly shaped opposite-direction revision after a linked opening fill returns 409 with no revision appended. The original opposite-side close still links. Direction changes before fills and ordinary stop/target revisions continue to work.

## Notable protections and deliberate limits

### Initial risk and sizing

The probe confirmed that widening a stop after the first entry does not replace the pre-entry stop in the R denominator. With entry 100, original stop 95, later stop 90 and net result 10, outcome risk stays 5 and R stays 2. The revision selection is at `backend/src/Vessel.Application/Plays/PlayOutcomeCalculator.cs:28-32`; the inspected regression is `backend/tests/Vessel.Tests/SizingTests.cs:161-170`.

This is an initial **planned-risk estimate**, not frozen realized risk reconstructed per execution. It multiplies actual entered notional by the plan's share-weighted stop distance. Partial entry allocation can differ from planned shares. Review's stronger prerequisites are at `backend/src/Vessel.Application/Review/ReviewService.cs:134-149`. The portfolio-review contract explicitly retains sizing's older partial-plan/fallback calculation and detected-close-time window. Those limits are not presented here as new arithmetic bugs.

### Review, fees and funding

- Review verifies positive quantities/prices, distinct fills, account/contract, normalized effects, opposing sides, balanced quantities, chronological exposure and complete supported fees. It rejects the bad Closed cases above rather than scoring them as zero. See `backend/src/Vessel.Application/Review/ReviewService.cs:100-131`.
- The probes confirmed gross USDC fees are subtracted once and net-of-fee P&L is not charged twice. A complete zero result counts as a scratch; an empty Review returns null net. Inspected tests cover these distinctions at `backend/tests/Vessel.Tests/ReviewTests.cs:98-110,164-181`.
- Review uses the latest actual exit timestamp rather than sync detection time at `backend/src/Vessel.Application/Review/ReviewService.cs:105-106`. Its pooled metrics use individual outcomes at `backend/src/Vessel.Application/Review/ReviewService.cs:155-182`, not averages of account percentages.
- Separate funding cashflows remain excluded, and RISEx funding inclusion remains explicitly unverified in the response notice at `backend/src/Vessel.Application/Review/ReviewService.cs:17-21`. This audit makes no claim of funding-complete P&L.
- Sizing deliberately retains unsupported-fee outcomes with `FeesComplete=false`; Review excludes them. That policy is documented in `docs/architecture/sizing-suggestions.md`. It is separate from the confirmed execution-integrity problems that cause known-bad closed outcomes to reach sizing.

### Activity

The probes confirmed that a partial exit stays inside one open operation, unsupported nonzero gross fees produce null net rather than zero, and a flip preserves total quantities and money across its two allocations. The full flip fee/P&L belongs to the closing part by the documented convention; that is not double charging.

Relevant code is `backend/src/Vessel.Application/Activity/OperationAggregator.cs:89-109,245-279`. `backend/src/Vessel.Application/Activity/ActivityPositions.cs:18-58` isolates ambiguous native identities instead of anchoring several markets to a legacy snapshot. Exact aggregation uses scaled integers at `backend/src/Vessel.Application/Activity/ExactAmount.cs:6-42`. Inspected tests include `backend/tests/Vessel.Tests/ActivityOperationsTests.cs:48-94,170-210,288-298`.

No additional Activity arithmetic defect met the confirmation threshold in this audit. That is not a claim of exhaustive verification.

### Concurrent Plays and retention

- Two matching active Plays yield two candidates in the probe, not a silent choice. Account-scoped execution locking and the unique linked-order index protect assignment exclusivity at `backend/src/Vessel.Persistence/ExecutionStore.cs:69-77` and `backend/src/Vessel.Persistence/VesselDbContext.cs:219-223`.
- Sync adds unseen fills without deleting older retained history at `backend/src/Vessel.Persistence/WorkspaceStore.cs:183-216`. It advances perps and wallet snapshots independently and does not replace them with equal/older observations at `backend/src/Vessel.Persistence/WorkspaceStore.cs:119-144`. The late-fill problem in B1 is therefore lifecycle handling, not sync deleting the missing fill.
- Order updates preserve a newer status against an older observation at `backend/src/Vessel.Persistence/ExecutionStore.cs:39-40`.
- Bounded venue history, omitted unsupported Lighter executions, no automatic retrospective Plays, one linked order belonging to one level, and unavailable funding attribution remain stated limits. None justifies converting a known contradictory execution set into a final, scoreable Play.

## Changed paths

Repository:

```text
docs/product-review/2026-10-13-backend-audit.md
```

Disposable files and compiler output exist only under `/tmp/vessel-backend-audit-7559248-FznS1g/`. No application, test, tracking or other documentation file was changed by this audit.
