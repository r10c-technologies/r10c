import { describe, expect, it } from 'vitest';

import {
  isSettlementRunStatus,
  SettlementRunStatuses,
} from './settlement-run-status.js';

describe('SettlementRunStatuses', () => {
  it('separates calculation from payment, so a run is re-runnable', () => {
    // Calculation is derived from the commission ledger and can be thrown away;
    // a paid run cannot. That split is the whole reason for two states.
    expect(SettlementRunStatuses).toEqual([
      'open',
      'calculated',
      'paid',
      'cancelled',
    ]);
  });
});

describe('isSettlementRunStatus', () => {
  it('accepts every declared status', () => {
    for (const status of SettlementRunStatuses) {
      expect(isSettlementRunStatus(status)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isSettlementRunStatus('settled')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isSettlementRunStatus(undefined)).toBe(false);
    expect(isSettlementRunStatus(42)).toBe(false);
  });
});
