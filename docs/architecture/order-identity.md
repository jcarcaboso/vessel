# Order identity: internal and external IDs

Status: **agreed for implementation** (October 17, 2026). The owner asked for internal and external order identities as a breaking change: Vessel is not deployed, so there is no data backfill and development databases are recreated.

## Problem

Imported orders and fills already have internal `Guid` keys, but every relationship uses the venue's order-ID string:

- `PlayOrderLink` stores `(AccountId, OrderId)`.
- Fills are attributed to links and orders by `(AccountId, OrderId)` in Activity, Diary, Sizing/Review, the execution lifecycle, event capture and monitor discrepancies.
- `imported_orders` is unique on `(OwnerId, AccountId, OrderId)`; the upsert overwrites `ContractId` when the same venue ID arrives for another instrument.

No supported venue reuses an order ID across instruments today (Hyperliquid `oid` is exchange-wide, Lighter `order_index` encodes the market, RISEx IDs are composite), so this is latent. But attribution correctness rests on an unenforced venue assumption, and two consumers (Review, the unassigned count) already filter by contract while the rest do not.

## Decision

Status changed to **agreed for implementation** after a Sol and an Opus challenge round (October 17, 2026). Relationships use internal IDs. Venue IDs are external identity only.

| Entity | Internal ID | External identity (unique) |
| --- | --- | --- |
| Imported order | `ImportedOrder.Id` | `(OwnerId, AccountId, ContractId, ExternalOrderId)` |
| Imported fill | `ImportedFill.Id` | `(OwnerId, AccountId, ContractId, SourceFillId)` (unchanged) |
| Play order link | `PlayOrderLink.Id` | — (references `ImportedOrderId`) |

- `ImportedOrder.OrderId` and `ImportedFill.OrderId` are renamed `ExternalOrderId` (column `"ExternalOrderId"`, keeping the existing quoted PascalCase convention).
- `PlayOrderLink.OrderId` is replaced by a required `ImportedOrderId`. The foreign key is composite `(OwnerId, AccountId, ImportedOrderId)` → alternate key `(OwnerId, AccountId, Id)` on `imported_orders`, so a cross-owner or cross-account link is impossible in the database. The link constructor takes the `ImportedOrder` and refuses one whose account or contract differs from the Play's (contract consistency is a domain rule, since the database cannot express it).
- The unique linked-order index becomes `(OwnerId, ImportedOrderId)` where state is Linked.
- **Fills carry no order reference.** Fills normally arrive before their order in the same refresh (`SaveRefreshAsync` then `RetainAsync`), so a back-filled reference would need a set-based update that leaves tracked fills stale and is invisible to event capture. Instead fills belong to an order by `(OwnerId, AccountId, ContractId, ExternalOrderId)`, through **one** shared rule: a Persistence helper (`LinkedFills`: link → order → fills on that key) and an Application `OrderKey(AccountId, ContractId, ExternalOrderId)` value for in-memory grouping. No consumer joins fills on the external ID alone. A new index `(OwnerId, AccountId, ContractId, ExternalOrderId)` on `imported_fills` backs it.
- The external key uses the canonical `ContractId` (non-null, shared by fills, Plays, matcher and catalogue). When an order row exists for the key with a non-null `VenueContractId` that differs from the incoming non-null native ID, import fails closed with a safe venue error instead of overwriting. A future canonical remap (like `k…` → `1000…`) is an identity change and needs its own migration.
- `MonitorExitWatch.OrderId` is removed: a link's order is immutable, so the watch identifies its order through `LinkId`. Matching against a fresh venue read uses the linked order's `(ContractId, ExternalOrderId)`.

## Resolution rules

- **Order import.** `UpsertOrdersAsync` keys existing rows and the incoming batch (deduplicated newest-status-first) by `(ContractId, ExternalOrderId)`, never writes `ContractId` on update, and keeps today's older-status skip rule.
- **Adapters.** Hyperliquid, Lighter and RISEx merge/deduplicate orders by `(contract, ID)`, preserving newest-status selection and complete-book duplicate detection.
- **Linking.** The matcher links `order.Id`; its `LinkIndex` keys become `(PlayId, ImportedOrderId, LevelKey)` and a set of linked order IDs. Manual link resolves the venue order ID within the Play's account **and contract** (another contract's order is 404). Retrospective preview scopes fills and orders to the operation's contract and returns the order rows so creation links internal IDs; its fingerprint hashes an explicit projection instead of whole entities.
- **Attribution.** Activity, Diary, Sizing/Review, `ExecutionIntegrity` inputs, lifecycle transitions, closed-event data and monitor assignment all use the shared rule. Manual-ledger `manual:{id}` fills stay outside it.
- **Events.** `FillOrders` mutation tracking uses `(AccountId, ContractId, ExternalOrderId)`. The `execution.filled` dedup key becomes `order:{accountId}:{importedOrderId}:filled:{cumulative}` (the external ID alone collides across contracts). Fill claims stay keyed by fill identity; payloads keep the external `orderId` string.

## Wire contracts

API DTOs, event payloads and the browser keep the external `orderId` string; link requests send the venue ID and unlink sends the link ID. No frontend change is expected. `scripts/e2e-full-stack.py` reads the watch `OrderId` column directly and must be updated.

## Migration

One new EF migration: renames, the link foreign key and alternate key, dropped `OrderId` columns on links and watches, and the new indexes. **No backfill.** It starts with a guard that raises an exception when `imported_orders`, `imported_fills` or `play_order_links` holds rows, so a database someone forgot to recreate fails loudly instead of being truncated. Recreate development databases. Earlier migration tests that seed `OrderId` columns target the pre-change migration. Record the breaking change in `CHANGELOG.md`. Apply explicitly; never to the owner's database during tests.

## Implementation waves

1. **Schema and compile (serial):** Domain, ports, EF configurations, migration and guard, `LinkedFills`/`OrderKey`, and the mechanical consumer changes needed to build and pass with unchanged behaviour.
2. **Parallel, disjoint scopes:** (A) execution, Diary, Activity, Sizing and Review on the shared rule with cross-contract tests; (B) event capture and the dedup key; (C) monitor watches, discrepancy observations and assignment; (D) venue adapters' merge keys.
3. **Integration:** same external ID on two contracts end to end, fills-before-orders events, migration guard, E2E script, docs and changelog.
