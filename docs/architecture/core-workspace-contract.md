# Core workspace contract

October 1, 2026. The owner requested the main application layout without the Play workspace and authorized backend core, Hyperliquid integration, PostgreSQL mounting and migrations.

The later [Plays first-pass contract](plays-workspace-contract.md) supersedes this record's original disabled-Play-navigation instruction. All backend/import limits below remain unchanged.

This step delivers account/portfolio management and a bounded manual-trigger read-only refresh. It does not implement automated jobs, complete lifetime history, Play editing, order placement or inferred fill matching.

## Work ownership

- Orchestrator owns `frontend/`, root configuration, this shared contract, integration and documentation.
- Backend core worker owns `backend/` except the Hyperliquid implementation/tests and `Vessel.Application/Venues/IPerpetualVenueReader.cs`.
- Venue worker owns only `Vessel.Infrastructure/Venues/Hyperliquid/` and `Vessel.Tests/HyperliquidAdapterTests.cs`.
- Shared normalized venue interface/types are already in Application. Neither worker changes them without coordinating.

## System metadata

Keep the existing system route and owner response shape. The API stage may become `core`; Hyperliquid venue status becomes `read-only`, not a claim of order placement or a running background sync. The frontend accepts both the prior foundation/planned metadata and the new core/read-only values during development.

## Owner-scoped endpoints

All routes below use the authenticated owner, never an owner ID supplied by the request body. GUIDs are JSON strings; money, price and quantity values are invariant decimal strings, not binary-float JSON numbers. Unknown values remain null.

### Portfolios

- `GET /api/portfolios` returns `PortfolioDto[]`.
- `GET /api/portfolios/{id}` returns the owner-scoped portfolio or 404.
- `POST /api/portfolios`, body `{ "name": "Swing trading" }`, returns created `PortfolioDto` with status 201.

`PortfolioDto`:

```text
id, name, accountCount,
totalValueUsd: string|null,
valueCoverage: "complete"|"partial"|"unavailable"
availableBalanceUsd: string|null, availableBalanceAccountCount, enabledAccountCount,
availableBalanceCoverage: "complete"|"partial"|"unavailable"
```

The first management workflow assigns each new account to one portfolio. Existing unassigned foundation accounts can remain unassigned until later migration/UI work. This is an initial workflow assumption, not permission to double-count accounts in future portfolio grouping.

### Accounts

- `GET /api/accounts` returns `AccountDto[]`.
- `GET /api/accounts/{id}` returns the owner-scoped account or 404.
- `POST /api/accounts`, body `{ portfolioId, name, venueId, address?, manualAccountValueUsd? }`, returns status 201 and `AccountDto`.
- New account choices are `manual` and `hyperliquid`. Lighter remains planned; Quantfury remains a feasibility candidate.
- Hyperliquid requires a valid 42-character public address. No private key or signing credential is collected.
- Manual account value is an optional nonnegative decimal string.

`AccountDto`:

```text
id, portfolioId: string|null, name, venueId,
address: string|null,
accountValueUsd: string|null,
availableBalanceUsd: string|null, availableBalanceSource: "wallet"|"margin"|"withdrawable"|null,
lastSyncedAtUtc: string|null,
syncStatus: "manual"|"not-synced"|"synced"|"error",
lastSyncError: string|null,
positionCount,
historyNotice: string|null
```

### Snapshots, fills and manual refresh

- `GET /api/accounts/{id}/snapshot` returns the latest `SnapshotDto` or JSON null if none exists; an absent/foreign account returns 404.
- `GET /api/accounts/{id}/fills` returns up to 100 latest owner-scoped `FillDto` items.
- `POST /api/accounts/{id}/sync` reads Hyperliquid account state, instruments and recent fills, persists a coherent result, and returns updated `AccountDto`.
- Sync is manual-triggered and bounded. Manual accounts return validation error for sync; no fake provider result is manufactured.
- Concurrent account refreshes should not duplicate fills. Scope source identity by account, venue contract and fill ID.
- Provider failures produce safe, generic errors and do not discard the previous successful snapshot. Auth values or raw provider details must not reach the frontend/logs.

`SnapshotDto`:

```text
observedAtUtc, valueScope,
accountValueUsd, withdrawableUsd, availableMarginUsd, marginUsedUsd,
positions: [{
  contractId, signedQuantity, entryPrice,
  unrealizedPnlUsd, marginUsedUsd, leverage: number|null
}]
```

`FillDto`:

```text
id, accountId, contractId, side, direction, price, quantity,
fee, feeToken, closedPnlUsd, occurredAtUtc, orderId,
sourceFillId, transactionHash, playId: null
```

Fill facts are never auto-linked to a Play, given a thesis, or labeled as a price-trigger confirmation. Fee currencies and source order/fill identities remain explicit. No full-history completeness is promised.

### Overview

`GET /api/overview` returns:

```text
portfolios: PortfolioDto[],
accounts: AccountDto[],
totals: {
  portfolioCount, accountCount,
  totalAccountValueUsd: string|null,
  valuedAccountCount, openPositionCount, importedFillCount,
  totalBalanceUsd: string|null,
  balanceAccountCount, balanceCoverage: "complete"|"partial"|"unavailable",
  availableBalanceUsd: string|null,
  availableBalanceAccountCount, availableBalanceCoverage: "complete"|"partial"|"unavailable",
  enabledAccountCount,
  availableStablecoinNominalUsd: string|null, stablecoinAccountCount
},
recentActivity: FillDto[],
scopeNote: string
```

Only known account values contribute to the aggregate. If no values are known, total is null, not zero. Counts and value coverage make partial knowledge visible. Hyperliquid values refer to the primary perpetual DEX margin snapshot, not a guarantee of the entire broker account value.

### October 12, 2026: combined balances and Overview actions

Overview shows Total balance and Available balance, with known-account counts out of enabled accounts and coverage. Both span all portfolios and unassigned accounts exactly once, never disabled accounts. The earlier `totalAccountValueUsd` remains the perps/manual subtotal; it is not the headline balance.

- Total balance sums each account's `Balance`: manual recorded value; supported-stablecoin wallet total alone for unified/portfolio-margin accounts; otherwise known perps equity plus any observed supported-stablecoin wallet total. A non-unified account with only one known ledger contributes that known amount. A unified account without an observed wallet contributes nothing, even if it has a perps field.
- Available balance selects one source per enabled account. A wallet-capable account in `unifiedAccount` or `portfolioMargin` uses observed supported wallet total minus held only. Without that observation it stays unknown, even if a perps field exists. All other modes use reported `availableMarginUsd` first, then `withdrawableUsd`. Standard Hyperliquid therefore uses perps `withdrawable`, not its separate spot wallet. Never add availability sources, derive availability from equity minus margin, or use manual value or discovery amounts as snapshot funds.
- `availableMarginUsd` stores Lighter account `available_balance` and RISEx summary `free_collateral`. The RISEx API defines free collateral as available for new positions. Lighter names an available balance but does not establish guaranteed withdrawal capacity in its account schema; Vessel does not relabel it as withdrawable. Missing, null or empty strings are unknown; an explicit zero is known. Signed exact decimals are preserved without clamping. Both venues keep `withdrawableUsd` null.
- Account DTOs expose the selected `availableBalanceUsd` and `availableBalanceSource` (`wallet`, `margin`, `withdrawable`, or null). Disabled accounts expose neither. Portfolio DTOs expose `availableBalanceUsd`, `availableBalanceAccountCount`, `availableBalanceCoverage` and `enabledAccountCount`, using the same selection as Overview. Account detail names the selected source and keeps the separate perps withdrawal field; account rows and portfolio tiles show availability without another ledger addition.
- Migration `20261012192227_AvailableMargin`, generated with the repository's pinned .NET EF CLI and persistence startup project, adds nullable unconstrained numeric `account_snapshots.AvailableMarginUsd`. Existing snapshots remain unknown until an explicit refresh. Apply it explicitly during deployment; verification uses only disposable databases.
- Coverage counts accounts with a known eligible amount, not completeness of venue valuation. No known accounts means null and `unavailable`; some means `partial`; all enabled means `complete`. An observed empty wallet is known zero. Exact ledger amounts reach `StablecoinTotals.Sum` without intermediate decimal addition, including within a single account.
- The legacy wallet-only subtotal also excludes disabled accounts. Position and imported-execution behaviour is unchanged.

Owner financial responses are not cached. The request client uses `cache: no-store`, API responses use `Cache-Control: no-store`, and `/api/overview` is outside the market-data compression allowlist. Refresh and management changes advance the shell request generation and reread Overview, including its portfolios and accounts.

Overview has a primary New play button and a separate keyboard-accessible Add menu for New portfolio and Add account. These reuse the existing editor and dialogs. New play opens a blank editor only when the current session is clean; unsaved draft or saved-Play changes reopen that editor with a notification instead of being discarded.

The `Usd`-suffixed fields preserve the initial shared contract's nominal dollar display convention. Hyperliquid collateral balances are USDC-denominated; oracle/contract quote units can differ. This slice performs no FX conversion and must not present the sum as a currency-aware fair-value calculation. Scope notes and the Overview metric name make that limit visible. A full currency/numeric contract remains later work.

## Failure contract

Use Problem Details for errors, with safe user-facing `detail`. Validation is 400, missing/foreign owner resources 404, provider failure 502 or unavailable service 503. Existing bearer failures remain 401. Do not disclose stack traces, connection strings or response bodies. Financial values use exact decimal storage compatible with .NET decimal; do not silently round provider numbers into a two-decimal schema.

## Boundaries and checks

Use existing clean dependency direction, migrations and PostgreSQL owner constraints. Provider endpoints are fixed server configuration, not user-supplied fetch URLs. Validate public addresses and bounded HTTP/JSON handling. Local tests use HTTP fixtures, not arbitrary real accounts.

Core tests must cover unauthorized calls, foreign resources, manual account creation, Hyperliquid validation, persisted snapshots and fill deduplication, failure preserving earlier data, portfolio coverage, multiple concurrent plays and explicit migration compatibility.

Frontend default becomes Overview with navigation for Overview, Portfolios, Accounts, Activity and Settings. Play navigation is disabled/marked later; it must not mount the approved Play workspace yet. Use real core API data with honest empty/loading/error states. No invented chart/P&L on the overview; no dummy working buttons for deferred features. The approved Play component and prototype are retained for later integration.
