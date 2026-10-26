import { describe, expect, it } from 'vitest';

import { publishedPriceOf } from './published-price.js';

describe('publishedPriceOf', () => {
  it('reads the vendor and the unit price off a published record', () => {
    expect(
      publishedPriceOf('o-1', {
        vendorId: 'v-1',
        amount: 12,
        currency: 'GTQ',
        name: 'x',
      }),
    ).toEqual({
      offeringId: 'o-1',
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
    });
  });

  it('answers nothing for a missing record or one without a price', () => {
    expect(publishedPriceOf('o-1', undefined)).toBeUndefined();
    expect(
      publishedPriceOf('o-1', {
        vendorId: 'v-1',
        amount: '12',
        currency: 'GTQ',
      }),
    ).toBeUndefined();
    expect(
      publishedPriceOf('o-1', { amount: 12, currency: 'GTQ' }),
    ).toBeUndefined();
    expect(
      publishedPriceOf('o-1', { vendorId: 'v-1', amount: 12 }),
    ).toBeUndefined();
  });
});
