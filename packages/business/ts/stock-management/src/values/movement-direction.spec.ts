import { describe, expect, it } from 'vitest';

import {
  isConsistentMovement,
  movementDirection,
} from './movement-direction.js';
import { MovementReasons } from './movement-reason.js';

describe('movementDirection', () => {
  it('gives every declared reason a direction', () => {
    // The table is exhaustive by type, but a reason added to the union without
    // an entry here would only fail at the call site that reads it.
    for (const reason of MovementReasons) {
      expect(movementDirection(reason)).toBeDefined();
    }
  });

  it('points goods arriving in and goods sold out', () => {
    expect(movementDirection('receipt')).toBe('in');
    expect(movementDirection('cancellation')).toBe('in');
    expect(movementDirection('sale')).toBe('out');
  });

  it('leaves an adjustment free to go either way', () => {
    // A count correction is the one reason that legitimately moves a total in
    // both directions.
    expect(movementDirection('adjustment')).toBe('either');
  });
});

describe('isConsistentMovement', () => {
  it('accepts a signed quantity that agrees with its reason', () => {
    expect(isConsistentMovement('receipt', 50)).toBe(true);
    expect(isConsistentMovement('cancellation', 1)).toBe(true);
    expect(isConsistentMovement('sale', -1)).toBe(true);
    expect(isConsistentMovement('adjustment', -3)).toBe(true);
    expect(isConsistentMovement('adjustment', 3)).toBe(true);
  });

  it('rejects a well-formed movement whose sign contradicts its reason', () => {
    // The document parses; what it says is that goods arrived and took stock
    // away.
    expect(isConsistentMovement('receipt', -50)).toBe(false);
    expect(isConsistentMovement('sale', 1)).toBe(false);
    expect(isConsistentMovement('cancellation', -1)).toBe(false);
  });

  it('rejects zero under every reason', () => {
    for (const reason of MovementReasons) {
      expect(isConsistentMovement(reason, 0)).toBe(false);
    }
  });

  it('rejects NaN and the infinities, which `$inc` cannot undo', () => {
    // `$inc` by NaN writes NaN, and no later movement moves it back — the fold
    // stops being replayable rather than merely being wrong.
    expect(isConsistentMovement('adjustment', Number.NaN)).toBe(false);
    expect(isConsistentMovement('receipt', Number.POSITIVE_INFINITY)).toBe(
      false,
    );
    expect(isConsistentMovement('sale', Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('accepts a fractional quantity, for a vendor selling by weight', () => {
    expect(isConsistentMovement('receipt', 2.5)).toBe(true);
  });
});
