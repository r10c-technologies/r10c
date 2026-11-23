import { type MovementReason } from './movement-reason';

/**
 * Which way a reason is allowed to move a quantity.
 *
 * `quantity` on a {@link StockMovement} is signed so that a movement is one
 * field rather than a magnitude plus a direction that can disagree with it
 * ([ADR 0010](../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 * One field cannot contradict itself, but it can still contradict its *reason* —
 * a `receipt` of `-50` is a well-formed document that says goods arrived and
 * took stock away.
 *
 * So the reason carries the direction, and the ledger refuses a movement whose
 * sign disagrees with it. `adjustment` is the deliberate exception: it is the
 * reason a count correction is recorded under, and a correction goes both ways.
 */
export type MovementDirection = 'in' | 'out' | 'either';

const DIRECTIONS: Record<MovementReason, MovementDirection> = {
  receipt: 'in',
  sale: 'out',
  cancellation: 'in',
  return: 'in',
  adjustment: 'either',
};

/** The direction a reason may move a quantity in. */
export function movementDirection(reason: MovementReason): MovementDirection {
  return DIRECTIONS[reason];
}

/**
 * Whether a signed quantity is consistent with the reason given for it.
 *
 * **Zero is never consistent**, under any reason. A zero-quantity movement is
 * an audit row asserting that nothing happened: it survives every fold, it
 * moves no total, and it makes "why is this vendor's stock wrong?" harder to
 * answer rather than easier — which is the one job the ledger has.
 *
 * ⚠️ **`NaN` and the infinities are rejected here or nowhere.** The total is
 * moved by `$inc`, and `$inc` by `NaN` writes `NaN` — a number that survives
 * every later increment unchanged and that no movement can undo, so the fold
 * becomes unrecoverable rather than wrong. The ledger is replayable precisely
 * because nothing in it can do that.
 *
 * A quantity is an integer in its unit's scale (ADR 0082 §2): 1.5 kg is
 * `1500` in `KG`, so a fraction here is a quantity that lost its unit. The
 * step is the catalog's rule for selling, not the ledger's — a vendor writes
 * off 0.137 m as `137`.
 */
export function isConsistentMovement(
  reason: MovementReason,
  quantity: number,
): boolean {
  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    return false;
  }

  switch (movementDirection(reason)) {
    case 'in': {
      return quantity > 0;
    }
    case 'out': {
      return quantity < 0;
    }
    case 'either': {
      return true;
    }
  }
}
