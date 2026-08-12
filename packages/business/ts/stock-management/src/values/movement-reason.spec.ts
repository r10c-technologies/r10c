import { describe, expect, it } from 'vitest';

import { isMovementReason, MovementReasons } from './movement-reason.js';

describe('MovementReasons', () => {
  it('names the four ways a quantity moves, and no more', () => {
    // Closed on purpose: the ledger is the audit trail, and a free-form reason
    // makes "why is this vendor's stock wrong?" unanswerable by query.
    expect(MovementReasons).toEqual([
      'receipt',
      'sale',
      'cancellation',
      'adjustment',
    ]);
  });
});

describe('isMovementReason', () => {
  it('accepts every declared reason', () => {
    for (const reason of MovementReasons) {
      expect(isMovementReason(reason)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isMovementReason('shrinkage')).toBe(false);
  });

  it('rejects a non-string, so a stored document cannot smuggle one in', () => {
    expect(isMovementReason(undefined)).toBe(false);
    expect(isMovementReason({ reason: 'sale' })).toBe(false);
  });
});
