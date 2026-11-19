import { describe, expect, it } from 'vitest';

import { taxShareOf } from './tax-share.js';

const ALLOCATION = { captured: 11_200, taxableBase: 10_000, taxAmount: 1_200 };

describe('taxShareOf', () => {
  it('gives back the whole base and tax on a full refund', () => {
    expect(taxShareOf(ALLOCATION, 0, 11_200)).toEqual({
      taxableBase: 10_000,
      taxAmount: 1_200,
    });
  });

  it('telescopes: partial refunds sum to exactly the allocation', () => {
    const parts = [3_333, 3_333, 4_534];
    let refunded = 0;
    let base = 0;
    let tax = 0;
    for (const amount of parts) {
      const share = taxShareOf(ALLOCATION, refunded, amount);
      base += share.taxableBase;
      tax += share.taxAmount;
      refunded += amount;
    }
    expect({ base, tax }).toEqual({ base: 10_000, tax: 1_200 });
  });

  it('shares nothing of an allocation that captured nothing', () => {
    expect(
      taxShareOf({ captured: 0, taxableBase: 0, taxAmount: 0 }, 0, 0),
    ).toEqual({ taxableBase: 0, taxAmount: 0 });
  });
});
