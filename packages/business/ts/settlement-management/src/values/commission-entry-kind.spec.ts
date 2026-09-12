import { describe, expect, it } from 'vitest';

import {
  CommissionEntryKinds,
  isCommissionEntryKind,
} from './commission-entry-kind.js';

describe('CommissionEntryKinds', () => {
  it('names the sale and the mirror that reverses it', () => {
    // Both rows stay on file: a deletion would leave a total nothing explains,
    // and an edit would erase what the platform actually took.
    expect(CommissionEntryKinds).toEqual(['sale', 'reversal']);
  });
});

describe('isCommissionEntryKind', () => {
  it('accepts every declared kind', () => {
    for (const kind of CommissionEntryKinds) {
      expect(isCommissionEntryKind(kind)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isCommissionEntryKind('refund')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isCommissionEntryKind(undefined)).toBe(false);
    expect(isCommissionEntryKind(42)).toBe(false);
  });
});
