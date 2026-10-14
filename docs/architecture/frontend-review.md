# Frontend review, October 14, 2026

A historical review of the frontend architecture and code after PR #37, looking for defects, simplifications and cleanups. Findings describe baseline `6acd5fe`, not later repair commits. The companion [frontend guide](frontend-guide.md) explains how the frontend works. The [backend review](backend-review.md) covers the API.

**Method.** I read all of `frontend/src` (about 14,600 lines of TypeScript, 1,750 lines of CSS and 12,400 lines of tests in 211 files) and the contracts it implements, and cross-checked the backend DTOs the runtime guards mirror. Baseline at `6acd5fe`: `typecheck` and `lint` pass with no warnings, 1,235 tests pass in 68 files, and `build` passes but warns that the main chunk is 807 kB (243 kB gzip). **No application code was changed during the original review.**

## What is already in good shape

- **The token never leaves memory.** `ConnectionGate` keeps it in the `WorkspaceApi` closure; no storage, URL or `VITE_*` variable sees it. Requests omit credentials, refuse redirects and never show raw server bodies.
- **JSON response bodies have runtime guards.** Hand-written guards check shapes, bounds, exact decimal strings and cross-field invariants before data reaches React. Binary response bodies use binary handling rather than JSON guards; SSE events are validated separately.
- **Exact numbers stay exact.** Amounts remain strings; `Intl.NumberFormat` formats the original string, and shares and comparisons use `BigInt` where precision matters.
- **Capabilities, not names.** The `Venues` context answers what a venue can do; almost no code branches on a venue ID.
- **Shell memory is deliberate.** Drafts, filters and the Overview scope live in the shell and survive navigation; a new `WorkspaceApi` identity resets them, and stale responses are discarded by generation keys.
- **The chart hot path was tuned.** Frame-batched drags, incremental series writes, a bounded per-connection candle cache and one shared live stream per chart.
- **Theming is token-driven.** Component CSS reads tokens, the theme builder only produces readable palettes, and a test enforces contrast for the built-in themes.
- **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are on, and lint allows no warnings.

The findings below are mostly about **shared plumbing that was copied per feature**, **a few lifecycle leaks and races**, and **two oversized modules** (the API client and the application shell).

## Categories

| Category | Meaning |
| --- | --- |
| **Required** | Fix now. The failure can already be triggered, or the documentation contradicts the code. |
| **Should fix** | A real maintenance cost, inconsistency or latent risk. Plan within the next few PRs. |
| **Nice to fix** | Small cleanups. Do them when touching the code nearby. |
| **Possible refactor** | Larger structural change worth discussing. Each needs owner agreement before work starts. |

Effort: **S** less than half a day, **M** one to two days, **L** several days or needs a design first. Paths are relative to `frontend/src` unless stated otherwise.

---

## Required

### R1. `frontend/README.md` contradicts the code — S

**Where.** `frontend/README.md`.

**Problem.** A newcomer who reads it first learns things that are no longer true:

- "Play persistence and financial calculations are not implemented", and "`features/plays/` … remain for later Play integration" (Plays are saved, planned, linked and reviewed).
- "`components/chart/` retains … sample renderer; no real candle API is enabled yet" (candles, live streams, drawings and indicators exist).
- "`public/fonts/` has the local Manrope font" (there is no `public/`; Inter comes from `@fontsource-variable/inter`).
- The page list leaves out Review; the structure section leaves out `features/market`, `features/review`, `features/settings`, `components/notifications` and `design/`.

**Suggestion.** Cut the README down to running, checking and the security rules, and link the [frontend guide](frontend-guide.md) for structure. This review only added a pointer at the top.

### R2. Evidence image URLs are never revoked when a draft is replaced — S

**Where.** `features/plays/evidence.ts:42` (`imageUrl`) and `:47` (`releaseImageUrl`). Only `EvidencePanel.tsx:57` releases a URL, when the owner removes one image.

**Problem.** `URL.createObjectURL` keeps its Blob alive until the URL is revoked. Discarding a draft, opening another saved Play, deleting a Play or disconnecting drops the images from React state but never revokes their URLs. A Play holds up to 50 images of up to 10 MB, so opening a few image-heavy Plays in one session keeps hundreds of megabytes alive until the tab reloads.

**Suggestion.** Tie each URL to the component that shows it: a small `useObjectUrl(blob)` hook that creates the URL in an effect and revokes it on cleanup (reference-counted, so the thumbnail and the viewer can share one Blob safely under StrictMode). Remove the module-level registry. Add a test that replacing the session revokes the URLs it created.

### R3. Execution checks and link changes race each other — S/M

**Where.** `features/plays/usePlayExecution.ts:23` (`run`), `:51` (initial read) and `:63` (the 60-second interval).

**Problem.**

- Every request writes its response when it finishes, so a slow check (up to 45 s, it refreshes the venue first) that started before a Link click can finish after it and overwrite the newer state. The order then shows as unlinked until the next check.
- `busy` is one boolean: whichever request finishes first clears it, re-enabling Link and Check while another request is still running.
- The initial execution read is aborted on cleanup, but checks and link mutations are not. Leaving the Play or the page lets a running check continue, and the interval can start a second check while one is in flight.

**Suggestion.** Number each request; apply a response only if no later-started request has already applied one. Count in-flight requests for `busy`. Give reads and checks an `AbortController` that is aborted when the Play changes or the hook unmounts, and skip the interval tick while a request is running. Add tests for out-of-order completion, busy tracking and abort on Play change (the hook has no tests today).

### S7. The in-chart level editor rounds typed prices and ignores the tick

Promoted to Required during independent Sol verification. The S7 identifier is
retained so implementation and review references stay valid. Effort: S.

**Where.** `features/plays/LevelEditor.tsx:29` and `:73`; `features/plays/levels.ts:184` (`addChartExit`). `PlayChart.tsx:268` does not pass `priceStep` to `LevelEditor`.

**Problem.** [venue-instruments.md](venue-instruments.md) says prices placed or dragged on the chart round to the instrument's tick, and typed prices are kept as entered. The in-chart editor does neither: a typed 84533.5 is stored as 84534 (five significant figures), and on a tick-size venue the shown and stored price ignores the tick. Stops and targets added from the editor (`addChartExit`) also round to five significant figures instead of the tick.

**Suggestion.** Pass `priceStep` to `LevelEditor` and `addChartExit`. Show the current price with the tick, keep a typed valid decimal exactly as entered (still switching a percentage level to price units), and round only generated prices. Record the decision in the chart plan and add tests.

---

## Should fix

### S1. The API layer has import cycles and depends on features — M

**Where.**

- `api/system.ts:1` imports `candleIntervals` from `api/workspace.ts`, which imports `ApiError` from `api/system.ts`.
- `api/workspace.ts:5` imports `clearCandleCache` from `features/market/candleCache.ts`, which imports `api/system.ts`.
- `api/overview-summary.ts:2` imports `portfolioIcons` (with its Lucide components) from `features/workspace`.
- `api/plays.ts:1` and `api/workspace.ts:24` import `ImageMarkup` from `features/plays/markup`.
- `components/chart/TimeframeBar.tsx` and `intervals.ts` import from `api/workspace`.

**Problem.** Eight runtime cycles run through `api/system.ts` and `api/workspace.ts`. They work only because no module touches an imported binding while it is being evaluated; adding one top-level constant that does turns into a `ReferenceError` at startup. The contract layer also depends on UI code, so a change to a feature can break the client.

**Suggestion.**

- Put shared contract values in leaf modules: candle intervals in `api/candles.ts`, the portfolio icon keys (strings only) in `api/portfolio-icons.ts`, the `ImageMarkup` shape in `api/`.
- Let the candle cache subscribe to the client instead of the client calling the cache: `createWorkspaceApi` accepts listeners for "unauthorized" and "account removed", or exposes them as events.
- Add an architecture test, like the backend's `ArchitectureTests`: `api/` imports nothing from `features/` or `components/`, `components/` imports nothing from `features/`, and there are no runtime cycles.

### S2. Runtime guards repeat their primitives with different rules — M

**Where.** 41 definitions of `object`, `text`, `guid`, `decimal`, `date` and `count` across the eight `api/*.ts` modules.

**Problem.** The same name means different things in different files:

| Guard | Differences |
| --- | --- |
| `object` | accepts arrays in `workspace.ts`, rejects them elsewhere |
| `text` | empty allowed or not; default maximum 200, 2,000 or 20,000 |
| `decimal` | `-?\d+(\.\d+)?` up to 100 or 160 characters; `review.ts` also requires a finite `Number`; `overview-summary.ts` limits the fraction to 28 digits; `diary.ts` accepts `+` and an exponent |
| `date` | any `Date.parse`-able string, an ISO timestamp with a zone, or UTC only |

Some differences are contract rules, most are accidents, and nothing says which. The `fill` guard is private to `workspace.ts`, so `isActivityDocument` and `isRetrospectivePreview` take it as a parameter. `isSavedEvidence` (`api/plays.ts:132`) accepts any object as `markup`, which the evidence panel then renders.

**Suggestion.** One `api/guards.ts` with named primitives and named profiles where a contract really differs (for example `plainDecimal`, `diaryDecimal`, `utcTimestamp`, `isoTimestamp`). Export the shared guards (`isImportedFill`, `isImageMarkup`) and drop the guard parameters. Keep every endpoint's acceptance rules unchanged, and pin them with table-driven tests.

### S3. The client has two request pipelines — S/M

**Where.** `api/workspace.ts:519` (`request`) and `:544`/`:560` (`send` and `json`); `getSystem` in `api/system.ts` is a third.

**Problem.** Both pipelines build the bearer header, combine abort and timeout signals, clear the candle cache on 401/403, map errors and validate bodies, but they differ in default timeout (10 s and 15 s), the 404 message ("account or portfolio" against "play or image") and the invalid-response wording. Which one an endpoint uses is historical. At baseline `6acd5fe`, `/api/review` uses `json` and reports a missing route as "This play or image is no longer available."

**Suggestion.** One internal `call(path, { validate, method, body, accept, timeout, notFound, badGateway, tooMany, safeError })` used by every endpoint, each endpoint stating its own timeout and messages explicitly (keeping today's values). Keep accepting any 2xx through `response.ok`, so `POST /api/plays/retrospective` may move from 200 to 201 (backend item N14).

### S4. Error messages are derived inline 21 times — S

**Where.** `cause instanceof ApiError ? cause.message : '…'` appears 21 times across features. `features/plays/saved.ts:8` exports `failure` for the same purpose, and `features/workspace/OverviewPlays.tsx` and `OverviewSummary.tsx` import it from Plays.

**Suggestion.** One `errorMessage(cause, fallback)` in `api/` (next to `ApiError`), used everywhere, with each call keeping its current fallback text.

### S5. `ApplicationShell` does too much — M

**Where.** `features/workspace/ApplicationShell.tsx`. `Shell` (line 54) is about 260 lines with JSX lines up to 900 characters. It holds routing, shell memory, the account refresh orchestration (`sync` at 169, `refreshAll` at 216), every dialog, and the full Overview (274), Portfolios (283) and Settings (299) page bodies inline.

**Problem.**

- The page bodies cannot be read, tested or changed on their own.
- `managementChanged` (197–199) decides what to reset by matching the start of a success message (`'Portfolio deleted'`, `'Account and'`). Rewording a notification silently breaks the reset.

**Suggestion.** Extract `OverviewPage`, `PortfoliosPage` and `SettingsPage`; a `useHashPage` hook for routing; and a `useAccountRefresh` hook for `sync`/`refreshAll` and their abort session. Report management changes as structured events (`{ kind: 'portfolio-deleted', id }`) with the message beside them. No visual or behaviour change.

### S6. The leverage-change confirmation is implemented twice — S

**Where.** `features/plays/PlayWorkspace.tsx:122–130` (accepting a suggested leverage) and `features/plays/PositionEditor.tsx:107–120` (the slider, input and presets). Each renders its own `LeverageChangeDialog`.

**Problem.** The rule "with percentage levels, ask whether prices or percentages follow" lives in two places with slightly different code. A fix to one misses the other, and two dialogs could be pending at once.

**Suggestion.** One `useLeverageChange(draft, onChange)` hook that owns the pending value and the dialog, used by both callers.

### S8. Light themes keep the `dark` class — S

**Where.** `frontend/index.html:2` sets `class="dark"`; `features/settings/appearance.ts:164` sets `data-scheme` and `color-scheme` but never the class. `index.html:6` also fixes `<meta name="theme-color">` to Graphite.

**Problem.** The shadcn controls use Tailwind `dark:` variants (`styles.css` defines `dark` as `.dark *`). On Paper, Daylight, Sand and light custom themes, inputs, outline buttons and tabs still get their dark-mode backgrounds (`dark:bg-input/30` and others). The browser address bar keeps the Graphite colour.

**Suggestion.** Toggle the `dark` class from the resolved scheme in `applyAppearance`, and set the theme-color meta to the theme background. This changes how those controls look in light themes; capture and compare them.

### S9. A few component styles still hard-code colours — S

**Where.**

- `components/chart/chart.css:132`: starred tools use `#e3b341`.
- `features/plays/plays-workspace.css:239`: the "Marked" badge uses `#ffd23f` on `#151c20`.
- `features/plays/markup.ts:164`: the markup selection outline is `#8fb8ff`.
- Box shadows use black with alpha in nine places (`#0007`, `#0002`, …).

**Problem.** [Appearance settings](appearance-settings.md) requires component CSS to read theme tokens. These do not follow the theme or the customizer.

**Suggestion.** Use `--warning` (and `--background` for its text) for the star and the badge, `--ring` or `--chart-drawing` for the selection outline, and one `--shadow-color` token for shadows, with today's values as the defaults. Image markup colours and the drawing palette are content, not chrome, and stay fixed (a known limit).

### S10. A render error blanks the whole application — S

**Where.** There is no error boundary. `main.tsx` renders `WorkspacePage` directly.

**Problem.** Any exception during rendering unmounts the root: the owner sees an empty page and loses the unsaved draft, which lives in shell state. An unexpected server value is enough, for example evidence `markup` without `shapes` (see S2).

**Suggestion.** An error boundary around each page inside the shell, so the shell, its memory and the Plays draft survive; the fallback offers Try again and a reload. Keep a last-resort boundary at the root.

### S11. Unsaved Play work is lost without warning — S

**Where.** `features/workspace/ApplicationShell.tsx:86` (`disconnectSession`) and the two Disconnect buttons; there is no `beforeunload` handler.

**Problem.** The Plays contract says reload and disconnect discard the draft. Nothing warns first: the owner card in the sidebar disconnects on one click, and a reload or closed tab drops plan edits, notes and up to 50 unsaved images.

**Suggestion.** While the Plays session has unsaved work (the same test `startNewPlay` uses) or a save is running, register a `beforeunload` handler, and ask for confirmation before Disconnect. Discarding stays the outcome; it is just no longer silent.

### S12. Every page is in the main bundle — S/M

**Where.** `features/workspace/ApplicationShell.tsx:7`, `:19` and `:20` import `PlaysPage`, `ReviewPage` and `AppearanceSettings` eagerly. The build warns that `index-*.js` is 807 kB (243 kB gzip).

**Suggestion.** Load Plays, Review and Settings with `React.lazy`, as the [performance plan](performance-plan.md) proposed, with a fallback in the existing loading style. The Plays session already lives in the shell, so nothing is lost. Measure the chunks before and after.

### S13. Plan numbers and display helpers are parsed and formatted in many places — S/M

**Where.**

- The "positive decimal" parser is defined four times (`features/plays/levels.ts:21`, `sizing.ts:4`, `suggestions.ts:19`, `planChecks.ts:7`), with further variants in `position-risk-summary.ts:39` and `LevelEditor.tsx:10`.
- Sign helpers: `resultSign` (`workspace/activity-format.ts`), `signClass` (`workspace/OverviewSummary.tsx`) and `tone` (`review/format.ts`, which goes through `Number`).
- Plays and Review import money formatting from `features/workspace/format.ts`.

**Problem.** Whether a plan value counts as a price must agree between plan checks, sizing, chart levels and suggestions; four copies can drift. Shared display helpers live in one feature and are borrowed by others.

**Suggestion.** `features/plays/numbers.ts` for plan-value parsing; `lib/decimal.ts` for exact sign and comparison helpers; `lib/format.ts` for the cross-feature formatters. Keep every rule and output unchanged.

### S14. Hooks with time-dependent behaviour have no tests — S

**Where.** `features/plays/usePlayExecution.ts`, `features/market/useMarketContext.ts` and `features/plays/LevelEditor.tsx` have no tests of their own.

**Suggestion.** Add focused tests with fake timers and controlled promises: polling and visibility, out-of-order responses (R3), aborts, the stale-context rule in `useMarketContext.apply`, and the editor's rounding (S7).

---

## Nice to fix

- **N1. Dead code and leftovers.**
  - About 30 CSS classes are not used anywhere: in `styles.css` (`app-shell`, `topbar`, `wordmark`, `page-heading`, `sample-notice`, `entry-picker`, `venue-status`, `chart-caption`), in `plays-workspace.css` (`sizing-assistant`, `assistant-*`, `capital-selection`, `entry-targets`, `level-mode`, `workspace-toolbar` and others) and in `application-shell.css` (`execution-name`, `tile-arrow`). Check dynamic class names (`play-status-*`, `is-*`) before removing.
  - `features/workspace/retrospective.fixtures.ts` and `components/chart/testFrames.ts` are test helpers in production folders; move them to `src/test/`.
  - `WorkspaceApi` marks six methods optional (`api/workspace.ts:244–246`, `:280–282`) although `createWorkspaceApi` always implements them; the "unavailable on this connection" branches they force cannot happen in production. Make them required and give the test fakes the methods.
  - Two comments start with a stray "ponytail:" (`components/chart/drawingController.ts:54`, `features/plays/position-risk-summary.ts:40`); the first also says "persistence will assign server IDs", which is no longer true.
  - `features/plays/PositionEditor.tsx:32` has an import after a function.
- **N2. Chart preferences.** `useChartPreferences` writes `localStorage` inside a state updater (`features/market/chartPreferences.ts:65`), which StrictMode runs twice, and every chart keeps its own copy. Use a small store with `useSyncExternalStore`, as `appearance.ts` does.
- **N3. Tooltip providers.** `ChartIconButton` wraps each button in its own `Tooltip.Provider` (`components/chart/ChartToolbar.tsx:35`), so the skip delay never applies between neighbouring buttons. Provide one at the shell and keep one in the test render helper.
- **N4. Plays page re-renders.** `PlayList` refetches on both transitions of `busy` (`features/plays/PlaysPage.tsx:432`); refetching when work finishes is enough. `isDirty` and `planChanged` serialize the whole draft, drawings included, on every render (`:141`), which happens once per frame while a drawing moves; memoize them on the draft.
- **N5. Missing aborts and a stale closure.** `PlaysPage.tsx:134` reads the Play without a signal; `PlayDialogs.tsx:84` sets the history without checking abort; `WalletAccountImport.tsx:45` cannot cancel discovery when the dialog closes; `saveDraft` and `changeStatus` choose where to show an error from the `dialog` value of the render that started them.
- **N6. Accessibility details.**
  - The Review toggles (`ReviewPage.tsx:143`, `ReviewChart.tsx:28`) set `aria-label` on a plain `div`; add `role="group"`.
  - Notifications create their `role="status"`/`role="alert"` element together with its text (`components/notifications/NotificationProvider.tsx:33`), which some screen readers do not announce; keep polite and assertive live regions mounted and add messages to them.
  - Instrument option IDs are built from contract IDs (`InstrumentPicker.tsx`); sanitize them.
  - Add a "Skip to content" link in the shell.
  - The drawing note field allows 200 characters (`DrawingEditBar.tsx:48`) while saved drawings allow 500 (`drawings.ts:178`).
- **N7. The manual venue ID is a literal.** `'manual'` is compared in `api/venues.ts:16`, `CreateDialogs.tsx:76/93/111` and `AccountDetail.tsx:38`. Add `manualVenueId` and `venues.isManual(id)`, mirroring the backend's `VenueDescriptor.ManualId`.
- **N8. Draft types duplicate API types.** `DraftExit` and `DraftEntry` (`features/plays/draft.ts:9`, `:16`) are field-for-field `PlanExit` and `PlanEntry`; alias them.

---

## Cross-cutting items for the backend

These need a backend change, so this work lists them and leaves them.

- **X1.** `CapitalContext` (`features/plays/WorkspacePanels.tsx:91`) decides whether perps equity is meaningful by matching Hyperliquid's account-mode names (`unifiedAccount`, `portfolioMargin`). The account DTO should state it, as backend item S6 suggests for the server.
- **X2.** Guards mirror the C# DTOs by hand. Generating types or validators from the OpenAPI document (backend P7, frontend P3) would catch drift in CI.
- **X3.** `FillDto.PlayId` is always null in Overview and account fills (backend N13), so a linked fill reads "Unassigned" wherever those rows are shown.
- **X4.** `POST /api/plays/retrospective` may return 201 instead of 200 (backend N14); the client already accepts any 2xx.

---

## Possible refactors

Each of these needs a short design note and owner agreement first.

- **P1. One request hook.** About ten components repeat the same pattern: state keyed by API identity and request key, an `AbortController`, an `active` flag, and loading and error derived from the key. A `useApiRequest(key, load)` hook would remove it, but each component keeps or drops previous data differently during a reload, so it needs care per page. A general query cache (TanStack Query) remains not recommended, as in the performance plan.
- **P2. Split the chart adapter.** `components/chart/lightweight.ts` (934 lines) combines the level primitive, the drawing primitive, pane layout, gesture handling and capture; `features/plays/PlayChart.tsx` combines the tool rail, plan tools, level history and the live chart. Splitting them would help, but only with browser verification of every gesture.
- **P3. A generated API contract.** See X2. Replace hand-written DTO types and guards with generated ones plus the extra invariants the guards check today.
- **P4. Drop rollout-compatibility fields.** Many DTO fields are optional only for "older servers" (`isEnabled?`, `settingsRevision?`, `balanceUsd?`, `origin?`, …). The API and web images now ship together; versioning the contract and making these required would remove fallback branches.
- **P5. URL state.** Account detail, the open Play and Review filters are not in the URL, so they cannot be linked to and Back leaves the page. A small router (or richer hashes) would fix that, but it touches shell memory semantics.
- **P6. A Plays session reducer.** `PlaysPage` coordinates saving, status changes, opening and manual executions with refs, epochs and a shared work guard. A reducer or state machine would make the rules explicit; it is the most delicate code in the app.
- **P7. Retire the standalone Review proposal.** `src/design/portfolio-review/` and `review-proposal.html` are a design mock, typechecked, linted and tested with the app. Move them to `prototype/` or delete them.
- **P8. One time display rule.** Times are local in some places and UTC in others (the [UI audit](../product-review/ui-ux-audit.md) noted it). Choosing one, or adding a setting, is a product decision.
- **P9. Progressive evidence loading.** Opening a saved Play waits for every image (performance plan, "later"); loading images after the draft needs care so unloaded images are never deleted on save.
- **P10. Feature folders by page.** `features/workspace` holds Overview, Portfolios, Accounts, Activity and the shell. Splitting it into `overview`, `accounts`, `portfolios` and `activity` would match the navigation.

---

## Suggested order

| Step | Content | Why first |
| --- | --- | --- |
| 1 | R1 (README) | Onboarding; documentation only. |
| 2 | S1, S2, S3, S4, N7, N1 (API methods) | One cross-cutting pass over the client, before features change around it. |
| 3 | S13, N3, N8, N1 (file moves) | Shared helpers, so later work uses them. |
| 4 | R2, R3, S6, S7, N4, N5 (Plays) | Leaks and races in the most-used page, with tests. |
| 5 | S5, S10, S11, S12 (shell) | Shell structure, resilience and bundle size. |
| 6 | S8, S9, N1 (CSS), N2, N6 | Theme correctness and accessibility, with visual comparison. |
| 7 | S14 | Tests for whatever the steps above did not already cover. |
