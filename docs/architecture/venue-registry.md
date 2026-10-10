# Venue registry and capabilities

October 5, 2026, slice S1 of the RISEx-first plan ([risex-integration.md](risex-integration.md)). Behaviour for Hyperliquid and manual accounts is unchanged. This is the seam through which every further venue (RISEx, then Lighter) plugs in.

## Contract

**Application** (`Vessel.Application.Venues`):

- `VenueDescriptor(Id, Name, Status, Source, Capabilities, QuoteAsset?, TradeUrlTemplate?)` describes a venue. `Source` is how an account is identified: `evm-address` or `none` (manual and planned venues). `TradeUrlTemplate` contains an `{instrument}` placeholder.
- `VenueCapabilities(Sync, Instruments, Orders, Candles, MarketContext, Stream, StablecoinWallet)`. Use cases and the browser check these, never a venue name.
- `IVenueRegistry` returns a venue's descriptor and its adapters: `Reader`, `Orders`, `Candles`, `MarketContext`, `Stream`. A missing adapter means the venue does not offer that capability. Each service turns that into its own safe error (502 or 503, with the same messages as before). When one venue has several registrations of a port, the last wins, as with a single injected service.
- `WorkspaceService`, `CandleService`, `MarketContextService`, `MarketStreamService` and `PlayExecutionService` resolve adapters through the registry. No `"hyperliquid"` literal remains in `Vessel.Application` except the two Hyperliquid-specific notices and comments scheduled for slice S3 (candle limit text and the matcher's price rule).

**Infrastructure:** each venue module registers its `VenueDescriptor` and adapters in `DependencyInjection`. Hyperliquid owns `HyperliquidPerpetualReader.Descriptor`; the manual venue is `VenueDescriptor.Manual`. `IVenueRegistry` is scoped.

## API: `GET /api/system`

`venues` is built from the registry, then the named-but-unbuilt venues (Lighter `planned`, Quantfury `candidate`) that have no adapter, with manual last:

```json
{ "id": "hyperliquid", "name": "Hyperliquid", "status": "read-only", "source": "evm-address",
  "capabilities": { "sync": true, "instruments": true, "orders": true, "candles": true,
                    "marketContext": true, "stream": true, "stablecoinWallet": true },
  "quoteAsset": "USDC", "tradeUrlTemplate": "https://app.hyperliquid.xyz/trade/{instrument}" }
```

Planned venues report every capability `false`. The browser accepts any number of venues as long as each states its capabilities, IDs are unique, `manual` is present and trade links are `https://` with an `{instrument}` placeholder.

## Behaviour that follows from the descriptor

- **Creating an account:** the venue must be registered (`Choose manual, hyperliquid or … .` otherwise). A venue with an `evm-address` source requires a 42-character hexadecimal address, with the venue's name in the message.
- **Refreshing:** needs `Sync`; otherwise `Only <sync venues> accounts can be refreshed.` A registered `Sync` venue without an adapter answers 503.
- **Order tracking:** a Play is tracked only when its account's venue has `Orders`.
- **Frontend:** account rows, the sync button, wallet panels, the account dialog (venue list, address field), the instrument catalogue, trade links and instrument labels read `useVenues()`. `VenuesProvider` is mounted by `ApplicationShell`; components outside it see no venues.

## Adding a venue

1. Implement the ports it supports in `Infrastructure/Venues/<Venue>/` and expose a `Descriptor`.
2. Register the descriptor and adapters in `DependencyInjection`.
3. Nothing else in Application or the frontend should need to name the venue. If it does, generalize that code first.

## Tests

`VenueRegistryTests` covers lookup (including last-wins), a fake second venue through create, catalogue and sync rules, capability-driven order tracking and the metadata order. `ApiTests` checks the contract shape. Frontend `venues.test.tsx` and `system.test.ts` cover lookups and contract validation. Tests that need venues in the browser tree use `@/test/render`.
