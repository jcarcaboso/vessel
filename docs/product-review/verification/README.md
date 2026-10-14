# Verification for the October 13 review

Target commit: `7559248f838068faff8cf8146844a031bc2a67c9`.

These are historical pre-fix findings. For the implemented fixes and P1
must-haves, use the [delivery receipt](2026-10-13-p1.md).

## Checks

- `pnpm check` passed. It ran 24 Python, 76 prototype and 1,018 frontend tests, locked restores, types, lint and builds. Default backend run: 1,068 passed and 81 skipped.
- A separate `dotnet test backend/Vessel.slnx --no-build --configuration Release` with `Vessel_TEST_POSTGRES` pointed at a new isolated PostgreSQL 18 container passed 1,147 tests. Two opt-in live venue tests were skipped.
- The application-code probes reproduced backend B1–B5 and passed ten control assertions. A parent recheck reproduced the same output in [2026-10-13-backend-probe.txt](2026-10-13-backend-probe.txt).
- Real HTTP and PostgreSQL corroborated B3's incompatible manual exit and B4. [2026-10-13-http-results.txt](2026-10-13-http-results.txt) retains the responses. The initial Review read preceded the synthetic future-by-one-second exit timestamps; the final read after those timestamps elapsed is the scoring evidence, with one valid and two excluded Plays.
- Browser reproduction confirmed R6, the concurrent evidence-note save bug. See the main review for precise steps and the discarded timeout attempt.

## Repeating the database-free probes

The retained program compiles the current Domain/Application sources directly, supplies in-memory stores and invokes reconciliation. It does not start a server or use a database, credentials, venue API or owner data. It prints reproduced defects and asserts controls; it is a diagnostic program, not a regression test suite expected to pass after fixes.

From the repository root:

```sh
dotnet run --project docs/product-review/verification/backend-probe/probe.csproj
```

The report's R1–R5 correspond to backend-audit B1–B5. Probe source references resolve relative to the repository, not the original temporary directory. Generated `bin`/`obj` files are not review artifacts.

The isolated HTTP fixture was populated with fabricated orders/fills through local SQL, then exercised through the actual API. That proves API behavior with retained facts, not successful import from a live venue. The reproduction inputs are documented in the backend audit; no server credentials or live owner identifiers are stored here.

## Browser scope

- Synthetic owner, manual account and public Hyperliquid placeholder `0x…0001` only.
- Real public catalogue/candles, manual and venue planning, side blocking, maximum leverage, liquidation warning, save/upload, Review with synthetic closed executions.
- Expanded editor at 320 px, Plays/Review at 390 px and desktop checks at 1280/1440 px.
- No full accessibility certification, touch-device test, exhaustive chart overlap test or live Lighter/RISEx claim.

The summary is a static local page with no JavaScript or external assets. The complete QA stack was created separately from existing development and review containers. Only the resources created for this review are cleaned up afterward.

## Completion and cleanup

The summary's linked files all returned HTTP 200, all three embedded images decoded, and its page width matched 1280, 390 and 320 px viewports without page-level overflow. Its in-page anchors were checked against actual IDs. Static checks found no JavaScript or external asset URLs.

The audit API on 5096 and Vite on 5196 were stopped. The explicitly created `vessel-product-audit-20261013` container and its anonymous volume were removed. Existing database containers and app/proposal services were not changed. Only the LAN static summary service on 5197 remains from this review.

VESSEL-42 was marked Done for the review, not for fixing its findings, and the completion comment was read back. The Outline Vessel document was reconciled and read back at revision 62. Repository reports are still uncommitted.
