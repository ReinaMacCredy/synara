# Supervised Compatibility Ledger

Status: active read compatibility; canonical writes only
Owner: Supervised Runtime
Earliest removal date: 2027-08-09

This ledger is the single authority for the deliberate compatibility window between the historical
Supervision/Specialist vocabulary and the canonical Supervisor/Lead/Peer Supervised model. The old
forms are accepted only to read, replay, and upcast data written before the canonical cutover. New
production writes are forbidden by `bun run compatibility:check` and its CI gate.

## Retained read paths

| Legacy form                                | Canonical form                            | Read/upcast owners                                                                                                                               | Removal evidence                                                                       |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `supervision.*` command and event envelope | Supervised governance commands and events | `packages/contracts/src/supervision.ts`, `apps/server/src/orchestration/supervised/governanceProjection.ts`, `apps/web/src/storeEventReducer.ts` | No unexpired legacy authority receipt; full migration 108 replay fixture passes        |
| `specialist` role and aggregate kind       | `peer`                                    | `packages/contracts/src/supervised.ts`, `apps/server/src/orchestration/supervised/peerUpcaster.ts`                                               | No retained legacy specialty/snapshot with an unexpired lease; replay fixture passes   |
| `supervised.specialist-upserted`           | canonical peer event                      | server/web projectors and wake policy                                                                                                            | Historical journal corpus upcasts without a legacy write or divergent projection       |
| legacy specialist payload keys             | peer/specialty canonical keys             | contract decoder and peer upcaster                                                                                                               | Stored payload inventory is empty or deterministically upcast by the removal migration |

Migration 108 (`SupervisedCanonicalCutover`) is the cutover fixture and must remain replay-safe. Its
upgrade tests cover legacy profiles, seats, roles, retained specialties, snapshots, and canonical
state without keeping duplicate authority arrays.

## Invariants during the window

- Production code writes only canonical Supervised vocabulary. Compatibility fixtures may construct
  legacy rows and events, but runtime modules may only decode, upcast, project, or reduce them.
- Every compatibility site carries the same earliest removal date. A later support decision moves the
  date here first and updates all dated TODOs in the same change.
- New legacy variants are prohibited. A historical payload that cannot be decoded by an existing
  adapter is a migration defect, not permission to add another production writer.
- Removal cannot rely on elapsed time alone. Operators must inventory persisted receipts, retained
  specialty leases/snapshots, journal events, and projected legacy rows before deleting decoders.

## Staged removal gate

On or after 2027-08-09, removal may begin only when all of these are true:

1. Migration 108 fresh-install and upgrade/replay tests pass against the oldest supported database
   corpus.
2. The persisted-data inventory proves that no unexpired legacy authority or retained-specialty data
   remains, or a reviewed migration upcasts it transactionally.
3. Event replay produces the same canonical governance/runtime/web projection before and after the
   compatibility adapters are removed.
4. `bun run compatibility:check` still proves zero production legacy writers.
5. Contracts, server projectors, web reducer cases, wake policy, fixtures, and dated TODOs are removed
   together in one staged migration change with rollback evidence.
