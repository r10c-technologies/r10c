import type { StockMovement } from '../stock-movement/stock-movement.entity';
import type { StockItem } from './stock-item.entity';

/**
 * What is left to promise: what is physically held, minus what is already
 * promised to someone else.
 *
 * Computed, never stored. A third counter would be a third thing to keep
 * consistent with the other two, and it is the one that would be wrong
 * ([ADR 0010](../../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * It can legitimately be **negative**: an `adjustment` correcting a miscount
 * downwards can land below what is already held by live reservations. That is a
 * real state a vendor has to see, not an error to clamp away — clamping it at
 * zero would hide exactly the oversell the correction just revealed.
 */
export function availability(item: StockItem): number {
  return item.onHand - item.reserved;
}

/**
 * The running total the ledger folds to.
 *
 * This is the **reconciliation** rule, not the write path: a route moves the
 * total with `$inc`, because an absolute-value write loses updates between two
 * requests inside a single process. What this function is for is the other
 * direction — replaying the movements a vendor's ledger holds and comparing the
 * answer against the materialized `onHand`, which ADR 0010 records as
 * not optional.
 *
 * Order-independent by construction: addition commutes, so a replay does not
 * need the movements sorted and cannot disagree with itself about a tie.
 */
export function foldOnHand(movements: readonly StockMovement[]): number {
  return movements.reduce((total, movement) => total + movement.quantity, 0);
}

/**
 * Whether the materialized total still equals its ledger.
 *
 * `reserved` is deliberately **not** part of this. It is moved by reservations
 * rather than by movements, so the ledger says nothing about it, and folding
 * the two together would report every live hold as a discrepancy.
 */
export function isReconciled(
  item: StockItem,
  movements: readonly StockMovement[],
): boolean {
  return item.onHand === foldOnHand(movements);
}
