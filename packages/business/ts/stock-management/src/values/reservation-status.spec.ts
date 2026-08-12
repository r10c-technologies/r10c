import { describe, expect, it } from 'vitest';

import {
  isReservationStatus,
  ReservationStatuses,
} from './reservation-status.js';

describe('ReservationStatuses', () => {
  it('holds the three states a hold can be in', () => {
    expect(ReservationStatuses).toEqual(['held', 'converted', 'released']);
  });

  it('opens in `held`, the only non-terminal state', () => {
    // Both other states are outcomes, so a reservation that is neither
    // converted nor released is by construction still holding stock.
    expect(ReservationStatuses[0]).toBe('held');
  });
});

describe('isReservationStatus', () => {
  it('accepts every declared status', () => {
    for (const status of ReservationStatuses) {
      expect(isReservationStatus(status)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isReservationStatus('expired')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isReservationStatus(null)).toBe(false);
    expect(isReservationStatus(3)).toBe(false);
  });
});
