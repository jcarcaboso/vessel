# Backend review, October 14, 2026

A review of the backend architecture and code after PR #37, looking for defects, simplifications and cleanups. The companion [backend guide](backend-guide.md) explains how the backend works.

**Method.** I read all of `backend/src` (about 10,700 lines, excluding migrations), skimmed the tests (about 18,500 lines) and cross-checked the docs, CI and the frontend's polling. The solution builds with 0 warnings (`TreatWarningsAsErrors`). Locally 1,316 tests pass and 124 are skipped: the PostgreSQL and live-venue tests need environment variables. CI runs the PostgreSQL tests. **No code was changed for this review.**

## What is already in good shape

- **Layering is real and enforced.** Domain and Application have no package references, and `ArchitectureTests` fails the build if a project reference points the wrong way.
- **Owner isolation is defended in depth:** query filters, composite `(OwnerId, Id)` foreign keys, a save-time guard and owner conditions repeated in raw SQL.
- **Venue boundaries are strict.** Reads are bounded, JSON is parsed strictly with duplicate-key rejection, vocabulary is normalized and checked before storage, and failures are safe and fixed messages.
- **Exact numbers are taken seriously.** Input is never silently rounded, sums cannot overflow, and unknown stays null.
- **Concurrency is explicit.** Row and advisory locks have a documented order, and real PostgreSQL tests observe lock waits.
- **Operations are safe.** Migrations are explicit, diagnostics are safe, production refuses to start with bad configuration, and credentials are sealed with a key ring kept outside the database.
- **Capabilities, not names.** The venue registry lets use cases ask what a venue can do.
- **Decisions are documented.** Most decisions have a contract or state document.

The findings below are mostly about **duplication that grew feature by feature**, **plumbing that is spread across classes**, and **a few design choices that will not survive the next phase** (background monitoring, longer history).

## Categories

| Category | Meaning |
| --- | --- |
| **Required** | Fix before the next feature phase (background monitor, history backfill). Either the failure can already be triggered, or a core invariant depends on a convention nobody enforces. |
| **Should fix** | A real maintenance cost, inconsistency or latent risk. Plan within the next few PRs. |
| **Nice to fix** | Small cleanups. Do them when touching the code nearby. |
| **Possible refactor** | Larger structural change worth discussing. Each needs owner agreement before work starts. |

Effort: **S** less than half a day, **M** one to two days, **L** several days or needs a design first.

---

## Required

### R1. Venue I/O runs inside database transactions and row locks — M/L

**Where.** `WorkspaceService.SyncAsync` (`Workspace/WorkspaceService.cs:334`) calls the venue at line 346 inside `IWorkspaceStore.WithAccountLockAsync` (`Persistence/WorkspaceStore.cs:100`). `PlayExecutionService.CheckAsync` (`Plays/Execution/PlayExecutionService.cs:70`) then takes the lock again and reads orders and the instrument catalogue (`TicksAsync`, line 228) inside it. Lighter's adapter also opens the credential under the same lock.

**Problem.** A transaction stays open, with the account row locked and a pooled connection held, while the server waits for venue HTTP calls. Each read has a deadline of up to 20 s; Hyperliquid alone makes six sequential calls. While that happens, any settings change, disable, delete or credential change for the account waits on `SELECT … FOR UPDATE`. That wait counts against Npgsql's default 30-second command timeout, so a rename during a slow refresh or execution check can fail with a 503. The browser already runs the execution check every 60 seconds while an active Play is open, so this overlap is easy to hit. A background monitor (play-lifecycle step 4) would hold these locks continuously.

**Suggestion.** Read first, then commit in a short transaction:

1. Read the account outside a transaction, and the Lighter token in its own short read.
2. Call the venue with no transaction open.
3. In a short transaction: lock the row, re-check that the account exists, is enabled and has the same source identity, then save.

The save is already idempotent: a snapshot is replaced only by a strictly newer observation, fills are de-duplicated (with a unique index behind it), and an order update older than the stored one is ignored. So two overlapping refreshes are harmless, and "a disable cannot be overwritten by an in-flight refresh" still holds through the re-check. If the owner wants only one venue read per account at a time, use a process-level keyed gate or a non-blocking session advisory lock, not the row lock.

This choice shapes the monitor design, so agree it with the owner before implementing it (see P1).

### R2. The owner write guard is fail-open for new entity types — S

**Where.** `VesselDbContext.ValidateOwnership` (`Persistence/VesselDbContext.cs:303`) switches over 18 entity types and falls through to `_ => (Guid?)null` (line 331). Each query filter is also added by hand in `OnModelCreating`.

**Problem.** All 18 tables are covered today. But adding a table without updating both places silently drops the save-time guard and the read filter for it, and owner isolation is a core invariant of the product.

**Suggestion.**

- Add a Domain marker interface `IOwned { Guid OwnerId { get; } }` and implement it on every entity.
- In `OnModelCreating`, loop over entity types, apply the owner query filter to each `IOwned`, and throw during model building for any entity type that does not implement it.
- In `ValidateOwnership`, use `entry.Entity is IOwned owned ? owned.OwnerId : throw`.
- Add a test that enumerates `db.Model.GetEntityTypes()` and asserts each one has a filter.

Combine this with S12.

### R3. `backend/README.md` contradicts the code — S

**Where.** `backend/README.md`.

**Problem.** A newcomer who reads it first learns things that are no longer true:

- "Active and Closed are minimal head states" (there are six statuses).
- "No … Play CRUD, inferred execution matching" (both exist).
- "Venues are `manual` or `hyperliquid`" and "synchronous Hyperliquid refresh only" (RISEx and Lighter exist).
- "the forty PostgreSQL tests" (124 tests are skipped without a database).
- The Infrastructure description mentions only the Hyperliquid reader.
- The route list leaves out plays, review, sizing, activity, overview summary, market data, credentials and discovery.

**Suggestion.** Cut the README down to running, testing, migrating and configuring, and link the [backend guide](backend-guide.md) for structure. Move the per-phase historical detail (review safeguards, stablecoin update, package provenance) into the existing state documents. This review only added a pointer at the top.

---

## Should fix

### S1. Exact-number logic is duplicated, with different acceptance rules — M

**Where.** At least eight implementations:

- `Activity/ExactAmount.cs`
- `Workspace/StablecoinTotals.cs`, which repeats `ExactAmount.From` and `ToString`
- `StrictJson.ParseDecimal` and `StrictJson.DecimalUnits`
- `ManualLedger.Number`, `Add`, `Multiply` and `Text`
- `WorkspaceService.TryExactNonnegativeDecimal`
- `AccountDiscoveryService.ExactAmount`
- `PlayDocuments.NumberPattern`
- five copies of the `"0.############################"` formatter (`WorkspaceService:22`, `PlayExecutionService:384`, `ManualLedger:149`, `ReviewService:272`, plus `SizingService:71`, which rounds to 8 places)

**Problem.** Exactness is the product's core promise, yet each entry point accepts different text:

| Entry point | Sign | Exponent | Other |
| --- | --- | --- | --- |
| Plan fields | yes | yes | |
| Manual executions | `+` only | yes | |
| Manual account value | no | no | digits and dot only |
| Venue JSON | `-` only | no | |

The BigInteger code is copied three times. A fix to one copy does not reach the others.

**Suggestion.** Create one Domain `ExactDecimal` module:

- parsing with named profiles (for example `PlanText`, `OwnerAmount`, `VenueAmount`);
- one invariant formatter;
- one 28-place `BigInteger` accumulator (today's `ExactAmount`, made public in Domain);
- checked `Add` and `Multiply`.

Keep the per-contract rules, but give them names in one place, and add table-driven tests. `StablecoinTotals.Sum` becomes `ExactDecimal.Sum(...)`.

### S2. Locking is spread across stores, and services reach into each other — M

**Where.**

- `pg_advisory_xact_lock(hashtextextended(…))` appears five times (`WorkspaceStore:47`, `PlayStore:55`, `ExecutionStore:86`, `DiaryStore:15`, `EvidenceStore:20`).
- There are two account-row lock implementations (`WorkspaceStore.WithAccountLockAsync` and `ExecutionStore.WithAccountLockAsync`).
- `PlayStore` constructs other stores to borrow their locks (`new WorkspaceStore(db)` at line 56, `new ExecutionStore(db)` at line 59).
- `PlayExecutionService` depends on the concrete `WorkspaceService` to call its `internal` `WithAccountLockAsync` and `RecordOrderHistoryNoticeAsync`.

**Problem.** The lock order (management, then account row, then execution, then Play) is a convention spread over five classes. A new path can take the locks in another order and deadlock. The begin-transaction-or-join and reload-after-lock code is copied each time.

**Suggestion.** Add one Persistence `PostgresLocks` (or `LockCoordinator`) with:

- `InTransactionAsync`
- `ManagementAsync(owner)`
- `AccountRowAsync(id)`, which reloads the row
- `ExecutionAsync(account)`
- `PlayRowAsync(id)`
- `KeyedAsync(name)`

Make its methods follow the documented order, and assert it in debug builds. Expose what Application needs as one small port (`IAccountLock`). That removes the `PlayExecutionService` → `WorkspaceService` coupling.

### S3. Application services are registered by Persistence — S

**Where.** `Persistence/DependencyInjection.cs:28-55` registers `WorkspaceService`, `PlayService`, `ReviewService`, `CandleService` and the others.

**Problem.** The storage project decides which use cases exist. Swapping or testing persistence means re-registering the application, and a newcomer looks for the services in the wrong place. Application cannot do the registration itself, because the architecture test forbids package references there.

**Suggestion.** Register application services in the composition root, for example a `Vessel.Api/ApplicationServices.cs` with `AddVesselApplication()`. Persistence then registers only the `DbContext` and stores.

### S4. Endpoints contain orchestration — S

**Where.**

- `POST /api/accounts/{id}/sync` (`Api/WorkspaceEndpoints.cs:87`) runs `WorkspaceService.SyncAsync`, resolves `PlayExecutionService` from `RequestServices`, retains orders and then reads the account again. The `AccountDto` that `SyncAsync` returns is thrown away.
- `/api/system` (`Program.cs:127`) parses claims itself.
- `/api/activity/retrospective` is mapped in `PlayEndpoints` with its own `RequireAuthorization`.
- Review endpoints are not grouped.

**Suggestion.**

- Add `AccountRefreshService.RefreshAsync(id)` returning the final DTO. It is also the natural home for R1.
- Give the owner's display name to `IJournalOwnerContext`, or use a small `IJournalOwner` reader.
- Map every route through `MapGroup("/api/…").RequireAuthorization()`.

### S5. Transport rules depend on matching path strings — S

**Where.** `Program.cs:72` and `85-108`: `Path.EndsWith("/credential")` and `Path.Contains("/manual-executions")`. `Cache-Control: no-store` is set in up to four places for the same response (global middleware, error handler, credential middleware and endpoint filter), plus explicit sets in `WorkspaceEndpoints:96,102` and `ReviewEndpoints:15` that the global middleware already covers.

**Problem.** A new token-bearing route whose path does not end in `/credential` silently loses the HTTPS guard and the 4 KiB body limit.

**Suggestion.** Use endpoint metadata, as `CompressMarketData` already does:

- `.WithMetadata(new RequestSizeLimitAttribute(4096))`. Routing applies `IRequestSizeLimitMetadata` before model binding; this is confirmed in ASP.NET Core 10.
- A `CredentialEndpoint` marker that a small middleware checks for HTTPS and `no-store`.

Remove the redundant `no-store` sets.

### S6. `WorkspaceService` and `IWorkspaceStore` do too much — M

**Where.**

- `WorkspaceService` (437 lines) mixes portfolio CRUD, account CRUD and settings, Overview, snapshot DTO mapping, the instrument catalogue, sync orchestration and the balance and availability rules.
- `IWorkspaceStore` has 20 members and six consumers. Market data needs only `MarketDataAccountAsync`; credentials need only the account lock.
- `OverviewSummaryService` consumes `WorkspaceService`'s string DTOs and parses them back with `ExactAmount.Parse`.
- The Hyperliquid account-mode names `"unifiedAccount"` and `"portfolioMargin"` are matched in shared code (`WorkspaceService.cs:393,402`).

**Suggestion.**

- Split by responsibility: `PortfolioService`, `AccountService`, `AccountRefreshService`, `OverviewService`, `InstrumentCatalogService`.
- Extract a pure `AccountBalances` calculator (balance, availability source, coverage) that works on decimals and formats once at the edge.
- Let the adapter state the wallet semantics (for example `VenueStablecoinWallet.IncludesPerpetualEquity`) instead of shared code knowing Hyperliquid's mode names.
- Split the store port to match: `IPortfolioStore`, `IAccountStore`, `IAccountFactsStore`, `IAccountLock`.

### S7. `WorkspaceException` is the error type for every module, and domain errors are translated by hand — S/M

**Where.**

- `WorkspaceException` (`Workspace/Contracts.cs`) is thrown from 25 files, including Plays, Evidence, Review, Sizing and the Persistence stores.
- Domain throws `ArgumentException` and `PlayRuleException`.
- `PlayService.Apply` and `SizingService` translate them to 400 and 409.
- Other services validate the same rules first, so they never reach the domain (for example `ValidateName` against `Account.UpdateSettings`).

**Problem.** The name misleads. Validation is duplicated between services and entities. An `ArgumentException` that escapes from framework code would be reported to the owner as their own input error if a service translated it, or as a 500 if not.

**Suggestion.**

- Rename the exception to a neutral `RequestProblemException` (or similar) in a shared namespace.
- Add Domain `DomainValidationException` (400) and `DomainRuleException` (409; `PlayRuleException` becomes one).
- Map both centrally in the error middleware.
- Remove `Apply` and the duplicated service-side checks where the entity already enforces the rule.

### S8. Statuses, roles and directions are string literals — M

**Where.**

- `ImportedOrder.Status` is a string. The `VenueOrderStatus` enum exists, but Persistence lowercases it, and services compare against `"open"`, `"filled"`, `"canceled"`, `"rejected"` and `"triggered"`.
- `Account.SyncStatus` (`"manual"`, `"not-synced"`, `"synced"`, `"error"`).
- Plan direction `"long"` and `"short"`: more than a dozen comparisons.
- Manual and operation roles `"entry"` and `"exit"`.
- Operation status and association.
- The `"manual"` venue literal appears 8 times even though `VenueDescriptor.ManualId` exists, including in Domain `Account`, which cannot see that constant.
- `ManualLedger` sets `FeeBasis = "unknown"`, a value outside the `ExecutionFacts` vocabulary, on purpose.

**Suggestion.**

- Use enums persisted with `HasConversion<string>()`, as `Play.Status` already is, and keep the wire format through JSON converters.
- Move the manual venue ID into Domain.
- Give the "unknown fee" state a named member instead of an out-of-vocabulary string.

### S9. Reads grow with all retained history, and matching is quadratic — M

**Where.**

- `ActivityStore.ReadAsync` loads every fill of every enabled account on each Activity and Overview-summary request.
- `DiaryStore.ActivityAsync` loads all fills of the account to preview one operation.
- `SizingStore.ClosedPlaysAsync` loads every closed Play with all its fills for Review and Sizing. The Plays editor loads Sizing.
- `PlayExecutionService.GetAsync` loads every order and link of the account to show one Play, and runs every 60 s through the check.
- `MatchAsync` (line 263) scans every retained order with `links.Any(...)` inside the loop (lines 277 and 282), so O(orders × links). It reloads orders, links and fills on each of up to three passes.

**Problem.** Fine at today's volumes. Venue imports are capped (for example 2,000 Hyperliquid fills per refresh), but retained facts are never pruned. The planned backfill or archive would multiply them.

**Suggestion.**

- Before backfill, seed a large synthetic dataset (100k fills, 10k orders) and measure.
- Cheap wins: hash lookups for links by order, matching only orders placed after the earliest active Play and not yet linked, and filtering `GetAsync` to the Play's contract and creation time.
- Larger options are in P6.

### S10. Venues are registered in three different ways — S

**Where.** `Infrastructure/DependencyInjection.cs`:

- Hyperliquid registers four typed clients with the same configuration copied four times (lines 28-47).
- RISEx registers four named typed clients.
- Lighter registers one typed client and forwards each port in scope.
- `IVenueAccountDiscovery` and `IVenueCredentialVerifier` are not in `IVenueRegistry`. Services resolve them with `IEnumerable<>.SingleOrDefault()`, which throws on a duplicate registration, while the registry lets the last one win.

**Suggestion.** Add one `AddVenueModule<TAdapter>(descriptor, configureClient)` helper that registers one named client and forwards whichever ports the adapter implements. Add `Discovery(venueId)` and `CredentialVerifier(venueId)` to the registry. Adding a venue then means one line in composition.

### S11. The `Vessel.Application.System` namespace shadows `System` — S

**Where.** `System/SystemMetadata.cs:3`. Inside Application, `System.X` now resolves to this namespace first, which forces `global::System…` in `OverviewSummaryService.cs:23` and `OperationAggregator.cs:305`. `SystemMetadata.Upcoming` still lists Lighter as `planned` (line 19); it is hidden only because the real descriptor exists.

**Suggestion.** Rename the namespace to `Vessel.Application.Metadata`. Remove the stale Lighter entry, and decide whether Quantfury should still be shown.

### S12. EF model configuration is long and depends on order — S

**Where.** `OnModelCreating` is about 270 lines. Every decimal is mapped to `numeric` by a loop in the middle (`VesselDbContext.cs:141-144`). The loop only reaches entity types already in the model at that point; today all of them are, because every entity has a `DbSet`.

**Suggestion.**

- Map decimals with `ConfigureConventions(b => b.Properties<decimal>().HaveColumnType("numeric"))`, keeping the explicit `(5,2)` on `SizingSettings.RiskPercent`.
- Split the configuration into one `IEntityTypeConfiguration<T>` per aggregate and use `ApplyConfigurationsFromAssembly`.
- Apply the owner filter and the composite owner foreign key in one loop (R2).
- Check that `dotnet ef migrations add NoOp` produces an empty migration.

---

## Nice to fix

- **N1. Dead code and leftovers.**
  - The `HexValidation` file class at the bottom of `WorkspaceService.cs` is unused.
  - `SizingService.Outcome` and `StopDistance` pass-throughs are used only by tests; tests can call `PlayOutcomeCalculator`.
  - `CandleCache.Set` is unused.
  - Blank-line runs remain in `HyperliquidPerpetualReader.cs` from splitting the partial classes.
- **N2.** `PlayDocuments.ReadDrawings` (`PlayPlanDocument.cs:112`) never disposes its `JsonDocument`, so pooled buffers are not returned. Use `JsonSerializer.Deserialize<JsonElement>(stored)`.
- **N3.** `[assembly: InternalsVisibleTo("Vessel.Tests")]` is hidden in `LighterReader.cs:11` but applies to the whole Infrastructure assembly. Declare it in the `.csproj`.
- **N4. Duplicated literals and checks.** `HyperliquidMarketStream.VenueId => "hyperliquid"` should use `HyperliquidPerpetualReader.Id`. `EvmAddress.Require` (Infrastructure) duplicates `AccountSource.IsEvmAddress` (Domain).
- **N5.** `Account.HistoryNotice` packs two notices behind a magic `"\nOrder history: "` separator in one 1,000-character column. A budget test keeps the combined length legal. Two columns (`HistoryNotice`, `OrderHistoryNotice`) would remove the parsing and the budget; the API can still return them joined.
- **N6. Credentials.**
  - The purpose string `VenueId + "-read-token"` is built in four places; use one helper.
  - `AccountCredentialService.Metadata` decrypts the token on every `GET` to report its status, while `AccountCredentialReader.IsUsableAsync` deliberately avoids decrypting. Pick one policy.
- **N7. Review and Overview.**
  - `ReviewService.GetAsync` and `ExclusionsAsync` repeat the filter validation and account scoping.
  - The fee-incomplete predicate is written twice (lines 135 and 139).
  - Period windows are exclusive at the start in Review (`> from`) but inclusive in the Overview summary (`>= from`).
- **N8.** Long user-facing notice texts are spread inline across services. A `Notices` class per module would make them easy to find and review together; keep them server-owned.
- **N9. Adapter boilerplate.** Adapters build a new `BoundedJsonHttp` on every property access (`Http => new(...)`); make it a field. `HyperliquidPerpetualReader` has a dozen one-line wrappers around `StrictJson`; call `Json.X` directly, as RISEx does.
- **N10.** The enum-to-wire helpers (`StatusName`, `ReasonName`, `Name<T>`, `Source(LimitSource)`) could become `JsonStringEnumConverter` with `[JsonStringEnumMemberName]` on the enums.
- **N11. Tests and analyzers.**
  - Group the 74 test files into folders (Domain, Application, Api, Persistence, Venues) and add `[Trait]` categories, so a fast unit subset can run with `--filter`.
  - Consider `<AnalysisLevel>latest-recommended</AnalysisLevel>` and `EnforceCodeStyleInBuild`; `.editorconfig` has no C# rules yet.
- **N12. Evidence cleanup.** A failed delete or upload leaves an unreferenced file, which is harmless by design, but nothing ever removes them. Add a maintenance command that compares the storage keys with `play_evidence.ObjectKey`.
- **N13. Overview consistency.** `OverviewSummaryService` reads accounts and snapshots through `WorkspaceService`, then reads facts again in a separate repeatable-read transaction, so one response is not one snapshot. `FillDto.PlayId` is always null in Overview and account fills even though links exist; the contract states this, so revisit it if the UI would benefit.
- **N14. HTTP status consistency.** `POST /api/plays/retrospective` returns 200 where `POST /api/plays` returns 201. "Venue reader is unavailable" is a 503 in `SyncAsync` but a 502 in `InstrumentsAsync` and `CandleService`.

---

## Possible refactors

Each of these needs a short design note and owner agreement first; the monitor, notification and broker designs in particular are to be shaped before any code.

- **P1. One refresh pipeline for both browser and monitor.**
  - Build R1's read-then-commit refresh as one application service: sync, retain orders, reconcile.
  - A future `IHostedService` monitor (play-lifecycle step 4) calls it on a schedule, and the 60-second browser polling can be retired.
  - This is the natural place to decide per-account scheduling, backoff and the "only one read in flight" policy.
- **P2. One execution-fact model.**
  - `ManualLedger` projects owner facts into fake `ImportedFill` objects (`OrderId = "manual:{id}"`, `FeeBasis = "unknown"`) to reuse the outcome calculation.
  - An `ExecutionFact` value (role, side, effect, quantity, price, fee, PnL, bases, source) consumed by `PlayOutcomeCalculator`, `ExecutionIntegrity` and Review would make both sources honest inputs.
- **P3. A typed, cached plan.**
  - The plan is `jsonb` text parsed by `PlayDocuments.Read` in 16 places, some inside loops. Its numbers are strings that are parsed again in the matcher, outcome calculation and Review.
  - Parse once per Play into a validated `ResolvedPlan` with decimal levels, using a lazy property or EF's JSON column mapping, and keep the exact text only for display and revisions.
- **P4. Richer fact and diary entities.**
  - `ManualExecution`, `ManualExecutionHistory`, `ImportedOrder`, `AccountCredential` and `DiaryRequest` have public setters; `DiaryService` edits fields directly when correcting a record.
  - Give them constructors and methods (`ManualExecution.Correct(...)`) with private setters, as `Play` and `Account` already have.
- **P5. Feature-sliced persistence.**
  - Mirror the Application folders in Persistence: per feature, its entity configurations and its store.
  - Together with S6, split "Workspace" into Accounts, Portfolios, Refresh and Overview.
- **P6. Derived reporting read models.**
  - Activity operations, Overview summaries and Review results are recomputed from all facts on every request.
  - When S9's measurements require it, cache them keyed by a data version (latest sync time, link and Play versions), or materialize operations at refresh time.
- **P7. A generated API contract for the frontend.**
  - The frontend hand-writes runtime guards (`isPlayExecution` and others) that mirror the C# DTOs.
  - Generating TypeScript types or validators from the OpenAPI document in CI would catch contract drift. This needs the frontend owner's agreement.
- **P8. Basic operational telemetry.**
  - Only unexpected failures are logged today.
  - Metrics for venue latency and failures, lock-wait time and refresh duration (OpenTelemetry, opt-in) would make R1 and S9 measurable on a real installation.

---

## Suggested order

| Step | Content | Why first |
| --- | --- | --- |
| 1 | R2 + S12 + N3 | Cheap, protects owner isolation, no behaviour change. |
| 2 | R3 (README rewrite) | Onboarding; documentation only. |
| 3 | S3, S4, S5, S10, S11, N1, N4 | Composition and transport cleanup, mostly mechanical, covered by the existing API tests. |
| 4 | Design note, then R1 + S2 (with P1 in mind) | Changes locking semantics; agree with the owner, then rely on the PostgreSQL concurrency tests. |
| 5 | S1 (+ N2) | One place for exact numbers, with table-driven tests. |
| 6 | S6, S7, S8, incrementally | Splitting the workspace module and typing statuses, a module at a time. |
| 7 | S9 measurements | Before any history backfill or archive work. |
