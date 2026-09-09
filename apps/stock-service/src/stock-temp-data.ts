/**
 * The seeded stock ledger, and the fold it produces.
 *
 * Not a production source.
 *
 * ⚠️ **The offering ids are a read-only input from another store.**
 * marketplace-admin-service seeds `product-offering-1 … -N` into
 * `tenant_<organizationId>`, and this module hangs stock off those ids without
 * reading that store — a plain id across a store boundary is the normal shape
 * here (`ProductSpecification.brandId` into `catalog-reference` is the
 * precedent), and a dangling one is a display gap rather than a corrupt record.
 * Reaching for the real ids instead would mean stock-service opening a handle
 * to the `catalog` store, which is the coupling ADR 0020's one-writer rule
 * exists to prevent — and it would put a boot-order dependency between two
 * services that otherwise have none.
 */

import type { MovementReason } from '@r10c/business-ts-stock-management';

/**
 * How many offerings the catalog seed writes.
 *
 * ⚠️ **Deliberately fewer than that number get stock**, see {@link STOCKED}.
 * This constant only has to be *no larger* than the catalog's count: naming a
 * higher one would seed stock for offerings that do not exist, which is the
 * dangling id above turned from a tolerable gap into a screen full of them.
 */
const SEEDED_OFFERINGS = 60;

/**
 * How many of them carry stock at all.
 *
 * The tail — `product-offering-41 … -60` — is seeded with **no `StockItem` row
 * whatsoever**, and that is the point of the number rather than an economy.
 * "No row" is a different code path from "zero on hand": `take-reservation.ts`
 * does not upsert, so a missing item is the first thing a reservation meets and
 * answers `409` from a branch nothing else reaches. A seed that gave every
 * offering a row would leave that branch unexercised on every machine.
 */
const STOCKED = 40;

const offeringId = (index: number): string => `product-offering-${index + 1}`;

/** A movement as it is stored — the `StockMovement` wire shape. */
export interface StockMovementRecord {
  id: string;
  offeringId: string;
  /** Signed: positive is `in`, negative is `out`. */
  quantity: number;
  reason: MovementReason;
}

/** A fold as it is stored — the `StockItem` wire shape. */
export interface StockItemRecord {
  id: string;
  offeringId: string;
  onHand: number;
  reserved: number;
}

/**
 * The movements each seeded offering gets, keyed by its position.
 *
 * Four shapes, cycled, so every read path has a row that exercises it and no
 * machine has to be hand-edited first:
 *
 * | Position | Movements                      | What it is for                       |
 * | -------- | ------------------------------ | ------------------------------------ |
 * | `0 mod 4`| one `receipt`                  | the ordinary case                    |
 * | `1 mod 4`| `receipt`, `sale`              | a fold of two, one of them negative  |
 * | `2 mod 4`| `receipt`, `sale`, `adjustment`| a fold of three, for reconciliation  |
 * | `3 mod 4`| `receipt`, then an equal `sale`| **zero on hand** — the sold-out path |
 *
 * ⚠️ The `3 mod 4` case is why the quantities are written out rather than
 * generated from the index alone: zero on hand has to be *reachable through the
 * ledger*, since a `StockItem` at zero with no movements explaining it is
 * exactly the unreconcilable state the fold exists to prevent.
 */
const movementsFor = (
  index: number,
): ReadonlyArray<{ quantity: number; reason: MovementReason }> => {
  const received = 10 + ((index * 7) % 90);
  switch (index % 4) {
    case 0:
      return [{ quantity: received, reason: 'receipt' }];
    case 1:
      return [
        { quantity: received, reason: 'receipt' },
        { quantity: -Math.ceil(received / 5), reason: 'sale' },
      ];
    case 2:
      return [
        { quantity: received, reason: 'receipt' },
        { quantity: -Math.ceil(received / 4), reason: 'sale' },
        // An `adjustment` may go either way (`movementDirection` answers
        // `'either'` for it), so a negative one here is what proves the
        // consistency check is not simply reading the sign of the reason.
        { quantity: -1, reason: 'adjustment' },
      ];
    default:
      return [
        { quantity: received, reason: 'receipt' },
        { quantity: -received, reason: 'sale' },
      ];
  }
};

/**
 * Every seeded movement, in ledger order.
 *
 * The ids are deterministic (`stock-movement-<offering>-<n>`) for the same
 * reason the catalog's are: a reproducible lab is what lets a test *name* a
 * row, and #223 exists because an assertion that passes against an empty store
 * proves nothing.
 */
export const stockMovementTempData: readonly StockMovementRecord[] =
  Array.from({ length: Math.min(STOCKED, SEEDED_OFFERINGS) }, (_, index) =>
    movementsFor(index).map((movement, position) => ({
      id: `stock-movement-${index + 1}-${position + 1}`,
      offeringId: offeringId(index),
      ...movement,
    })),
  ).flat();

/**
 * The fold of {@link stockMovementTempData}, computed rather than written.
 *
 * ⚠️ **Never a hand-written total.** `onHand` is a fold of the ledger, so a
 * seeded figure that did not come from summing these movements would be a state
 * the reconciliation job ADR 0010 requires can never reproduce — and
 * reconciliation is how a bad `$inc` is ever found. Deriving it here means the
 * seeded lab satisfies `isReconciled` by construction.
 *
 * `reserved` is `0` on every row: a hold is taken by the crossing, and a seeded
 * one would be a hold with no checkout behind it that the (unbuilt) reaper
 * would then have to explain.
 */
export const stockItemTempData: readonly StockItemRecord[] = Array.from(
  { length: Math.min(STOCKED, SEEDED_OFFERINGS) },
  (_, index) => ({
    id: `stock-item-${index + 1}`,
    offeringId: offeringId(index),
    onHand: movementsFor(index).reduce(
      (total, movement) => total + movement.quantity,
      0,
    ),
    reserved: 0,
  }),
);
