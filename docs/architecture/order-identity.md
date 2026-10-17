# Order identity: internal and external IDs

Status: **draft for challenge** (October 17, 2026). The owner asked for internal and external order identities as a breaking change: Vessel is not deployed, so there is no data backfill and development databases are recreated.

## Problem

Imported orders and fills already have internal `Guid` keys, but every relationship uses the venue's order-ID string:

- `PlayOrderLink` stores `(AccountId, OrderId)`.
- Fills are attributed to links and orders by `(AccountId, OrderId)` in Activity, Diary, Sizing/Review, the execution lifecycle, event capture and monitor discrepancies.
- `imported_orders` is unique on `(OwnerId, AccountId, OrderId)`; the upsert overwrites `ContractId` when the same venue ID arrives for another instrument.

No supported venue reuses an order ID across instruments today (Hyperliquid `oid` is exchange-wide, Lighter `order_index` encodes the market, RISEx IDs are composite), so this is latent. But attribution correctness rests on an unenforced venue assumption, and two consumers (Review, the unassigned count) already filter by contract while the rest do not.

## Decision

Relationships use internal IDs. Venue IDs are external identity only.

| Entity | Internal ID | External identity (unique) |
| --- | --- | --- |
| Imported order | `ImportedOrder.Id` | `(OwnerId, AccountId, ContractId, ExternalOrderId)` |
| Imported fill | `ImportedFill.Id` | `(OwnerId, AccountId, ContractId, SourceFillId)` (unchanged) |
| Play order link | `PlayOrderLink.Id` | — (references `ImportedOrderId`) |

- `ImportedOrder.OrderId` is renamed `ExternalOrderId` (column `external_order_id`).
- `ImportedFill.OrderId` is renamed `ExternalOrderId`; a nullable `ImportedOrderId` references the order with the same owner, account, contract and external ID.
- `PlayOrderLink.OrderId` is replaced by a required `ImportedOrderId` with a composite owner foreign key (`OwnerId, ImportedOrderId`) and restrict-delete (account deletion already deletes links/Plays first; verify).
- Unique linked-order index becomes `(OwnerId, ImportedOrderId)` where linked.

## Resolution rules

- **Fill import.** When a fill is stored, `ImportedOrderId` is set if an order with the same `(account, contract, external ID)` exists.
- **Order import.** After orders are upserted (keyed by contract + external ID, never overwriting another contract's row), a set-based update attaches unresolved fills of the same account/contract/external ID. Both happen in the same unit of work as today's import.
- **Linking.** The matcher works on order rows, so it links `order.Id` directly. Manual link (`POST …/link` with a venue order ID) resolves the ID within the Play's account **and contract**; another contract's order is not found (404). Retrospective Plays already require an order record; they link the internal ID.
- **Attribution.** Every consumer joins link → order → fills on `ImportedOrderId`; fills without an order reference are never attributed to a Play. Activity's per-fill Play map, Diary, Sizing/Review, `ExecutionIntegrity`, lifecycle transitions, closed-event data and monitor assignment use one shared read rule.

## Wire contracts

- API DTOs and event payloads keep the venue order ID string (`orderId`) as today: it is what the owner recognises on the venue. Link/unlink requests keep sending the venue ID (link) or link ID (unlink). No frontend change is expected; confirm.
- Event types, payload shapes and dedup keys stay unchanged (fill claims are keyed by fill identity).

## Migration

One new EF migration changes the schema in place with **no backfill**. It is a breaking change for any existing database: recreate development databases. Document it in `CHANGELOG.md`/release notes for the next version. Apply explicitly; never to the owner's database during tests.

## Open questions for the challenge round

1. Should the order's external key use `ContractId` (canonical) or `VenueContractId` (native)? Canonical aliases (`k…` → `1000…`) map one native contract to one canonical ID, so either works; canonical matches fills' key.
2. Should fills carry `ImportedOrderId` at all, or should consumers join fills via the order's external key + contract? (Null-until-resolved adds a maintenance step; the join adds a contract predicate everywhere.)
3. Monitor watches and discrepancy identities that key on order ID strings: switch to internal IDs or keep `(contract, external ID)`?
4. Adapter-level merges (Lighter inactive pages, RISEx history + TP/SL) dedupe by order ID only: key them by `(market, ID)` too.
