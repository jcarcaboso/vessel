# Robinhood Lighter venue and venue logos

October 14, 2026. The owner asked to add Lighter on Robinhood Chain as a new venue, improve how account venues are shown and identify them with logos. After the investigation below the owner authorized implementation with Opus implementation agents, Sol (Codex) verification and a pull request with screenshots; the decisions are in [Delivery contract](#delivery-contract).

Research checked October 14, 2026 against [Robinhood's Lighter domains page](https://docs.robinhood.com/chain/lighter-domains/), [Lighter on Robinhood Chain](https://apidocs.lighter.xyz/docs/lighter-rh), [Lighter environments](https://apidocs.lighter.xyz/docs/environments) and live unauthenticated reads of `orderBooks`, `orderBookDetails` and `assetDetails`. No account, address or credential was used.

## What the venue is

Lighter on Robinhood Chain ("Lighter RH") is a **separate Lighter exchange**, not a Lighter market group: its own contracts, sequencer, liquidity, accounts, account indexes, API keys, nonces and market IDs. A transaction or account from one is meaningless on the other.

| | Lighter (existing) | Lighter RH |
| --- | --- | --- |
| REST | `https://mainnet.zklighter.elliot.ai/api/v1/` | `https://api.rh.lighter.xyz/api/v1/` |
| WebSocket | `wss://mainnet.zklighter.elliot.ai/stream` | `wss://api.rh.lighter.xyz/stream` |
| Chain ID (signing only) | 304 | 466324 |
| Web app | `app.lighter.xyz` | `robinhoodchain.lighter.xyz` |
| Collateral, asset 3 | USDC | **USDG** (6 decimals) |
| Sub-accounts | 4/16/64 by tier | 8 on every tier |
| Standard fees | 0% | 0% (Plus 0.005%, Premium 0.0084–0.035%) |
| `trades` REST weight | 200 | **600** |

Live reads return the same shapes our Lighter adapter already parses: `order_book_details` (58 perps) plus `spot_order_book_details` (27 `…/USDG` spot markets, ignored as today). Perps include crypto (BTC, ETH, HYPE, SOL…), US stocks and ETFs (AAPL, TSLA, NVDA, SPY, QQQ…), commodities (XAU, XAG, USO) and pre-IPO markets (OPENAI, ANTHROPIC, SPCX). `trading_hours` is empty on every market today. Symbols overlap with Lighter's (BTC, ETH…) but market IDs do not; they share canonical instrument keys, never contract IDs. Read-only `ro:` tokens are documented as working as on mainnet; the token-creation page path on the RH web app is unverified.

## Proposed venue identity

- ID `lighter-rh`, name **Lighter · Robinhood**, source `account-index`, same capabilities as Lighter (sync, instruments, orders, candles, account discovery, read-only credential; no market context or stream), quote asset `USDG`.
- Credential purpose becomes `lighter-rh-read-token` automatically (`<venueId>-read-token`), so tokens for the two exchanges are encrypted and bound separately. A Lighter token pasted into an RH account fails verification against the other host.
- No migration: venue IDs are free `varchar(64)`, and the unique account index includes `VenueId`.

## Backend change: one Lighter module, two instances

The registry, application layer and browser are venue-neutral. The Lighter module is not: `LighterReader` has a constant `Id = "lighter"`, a static descriptor, a host hard-coded in `DependencyInjection`, one typed `HttpClient`, a singleton catalogue cache with a fixed key and a static concurrency gate.

1. Introduce a `LighterExchange` settings record (venue ID, display name, base URL, quote/collateral symbol and asset ID, credential setup URL, trade URL template, per-exchange paging budget). Two static instances: `Lighter.Mainnet`, `Lighter.Robinhood`. All user-facing messages use the display name.
2. Register each exchange with its own named `HttpClient` (base address, 20 s timeout, `LighterAuthenticationHandler`, no redirects), descriptor and the five port forwards, constructing the reader from the factory rather than a typed client. Each exchange gets its own catalogue cache and read gate.
3. Replace the USDC constant in the reader with the exchange's collateral: asset-3/USDG identity check, non-USDG collateral rejection (RH margin-enables tokenized stocks such as AMZN at LTV 0.5, which we still refuse rather than value), snapshot scope `lighter-rh-perps-account`.
4. Lower the RH fill-history page budget to respect the 600 weight, keeping the existing bounded-history notice.
5. Remove the stale "planned Lighter" metadata entry; update `venue-registry.md`, `venue-credentials.md` and `lighter-state.md` to say descriptors and purposes are per instance.

Behaviour for existing Lighter accounts must not change (same ID, host, messages, notices).

## The decision that matters: USDG next to USDC

Results, fees and balances are USDC-shaped today. `PlayOutcomeCalculator`, `OperationAggregator`, `ReviewService`, `ManualLedger` and the sizing/overview notices treat only `USDC` fees as deductible and mark other fee tokens unknown. Standard RH accounts pay no fees, so this barely bites at first, but Plus/Premium RH fills would carry USDG fees and become "net result unknown". P&L and balances in USDG would also be pooled with USDC in Overview, portfolio tiles, Review and sizing.

Options:

- **A. Nominal USD stablecoins (recommended).** Treat USDG as a supported nominal USD stablecoin, as `stablecoin-wallet.md` already does for USDE/USDT0/USDH: one nominal unit each, no FX or depeg valuation, caveat shown. Generalize the fee rule from "fee token is USDC" to "fee token is the fill's own settlement stablecoin". Pooled sums stay nominal with an explicit caveat.
- **B. Keep USDG separate.** Show RH figures but exclude them from cross-venue totals, Review pooling and sizing until a currency model exists. Safer arithmetic, more visible gaps.

## Venue presentation and logos

Today an account shows a generic `Wallet` icon in `.venue-mark` plus the venue name; Review prints raw venue IDs; nothing distinguishes two Lighter exchanges at a glance.

- **Assets are bundled, not fetched.** Logos are downloaded once into `frontend/src/assets/venues/` (small SVG, or 64 px PNG) and served same-origin under the existing CSP. The browser never loads venue sites, as with every other venue call. The RH web app ships the **same icon file** as Lighter, so the RH mark is the Lighter mark with a small Robinhood badge in the corner.
- **Mapping:** descriptors gain an optional `logo` key from a fixed set (`hyperliquid`, `lighter`, `lighter-rh`, `risex`, `manual`), validated on both sides like portfolio icons. Unknown or missing keys fall back to the generic icon. The browser maps a logo key to an asset; it still never branches on venue IDs.
- **One `VenueBadge` component** (logo + name, compact variant logo-only with tooltip) used in account rows, account detail, portfolio account lists, the Accounts venue filter (logo chips), the Plays account picker, the Create-account venue picker (logo cards instead of a dropdown) and Review (names instead of raw IDs).
- Logos sit on a neutral theme-token tile so dark and light themes keep contrast; brand colours stay inside the logo.
- Trademarks are used only to identify the venue the owner's own account lives on.

## Phasing

1. **V1 – presentation:** logo set, `VenueBadge`, Review names. Independent of RH; can ship first.
2. **R1 – Lighter generalization:** exchange record, per-instance registration, cache and gate, messages. No behaviour change, existing tests unchanged.
3. **R2 – Lighter RH:** register the RH instance, USDG collateral per the chosen option, page budget, fixtures from live public reads, opt-in live test.

## Delivery contract

Owner decisions, October 14, 2026:

1. **Hosts are per-venue configuration.** No venue host stays hard-coded in `DependencyInjection`. `Vessel:Venues:<Section>` in `appsettings.json` carries `BaseUrl` (and `StreamUrl` where a venue streams) for Hyperliquid, RISEx, Lighter and Lighter RH, with today's hosts as defaults. Options are validated at startup: absolute `https://` (`wss://` for streams), no user info, query or fragment, normalized trailing slash. Invalid configuration fails startup with a message naming the key, never a value that could hold secrets. Tests may override hosts; production behaviour is unchanged.
2. **Common Lighter logic, two derived venues.** The Lighter protocol code is shared; `lighter` (existing, unchanged ID, host, names, notices) and `lighter-rh` ("Lighter · Robinhood", collateral/quote `USDG` asset 3) are two configured instances with their own descriptor, named `HttpClient` (auth handler, no redirects, 20 s timeout), catalogue cache, read gate, credential purpose (`<venueId>-read-token`, automatic), setup URL (`https://robinhoodchain.lighter.xyz`) and trade URL. RH respects the higher `trades` weight with a smaller paging budget and the existing bounded-history notice. Non-collateral margin assets are still refused. The stale planned-Lighter metadata entry goes.
3. **Several stablecoins at nominal value.** A single Application list of nominal USD stablecoins (USDC, USDG, USDT, USDT0, USDE/USDe, USDH) replaces every USDC-only rule: fees in any listed stablecoin are deducted one-for-one; other fee tokens stay unknown, never converted. Pooled balances and results across venues add nominal units with a visible "nominal 1:1, no FX or depeg valuation" caveat. Exact strings and integer-arithmetic sums are preserved. Manual executions accept any listed stablecoin as fee currency.
4. **Logos bundled with the app.** `VenueDescriptor.Logo` is an optional key from a fixed set (`hyperliquid`, `lighter`, `lighter-rh`, `risex`, `manual`) exposed as `logo` in `/api/system`, validated by the backend list and the frontend `venue-logos.ts` (kept in step, like portfolio icons). Unknown or missing keys fall back to the generic icon. Assets are same-origin files; the browser never fetches venue sites. The RH logo is the Lighter mark with a Robinhood badge.
5. **Account and venue UI.** A shared `VenueBadge` (logo + name; compact logo-only with accessible name) is used wherever accounts or venues appear: account rows, account detail, portfolio account lists, Accounts filters, the create-account venue picker (logo cards), Lighter import, Overview summary, Plays account selection and Review (names, not raw IDs). The Accounts page layout may be refined; the Plays page section positions may not move. Theme tokens only, both built-in themes keep contrast, logos sit on a neutral token tile.

Verification: one Sol review per wave, two independent Sol reviews of the full diff, `pnpm check`, synthetic-data screenshots attached to the PR. No migration of the owner's database.
