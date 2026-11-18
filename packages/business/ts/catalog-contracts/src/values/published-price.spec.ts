import { describe, expect, it } from 'vitest';

import { publishedPriceOf } from './published-price.js';

describe('publishedPriceOf', () => {
  it('reads the vendor, the name and the unit price off a published record', () => {
    expect(
      publishedPriceOf('o-1', {
        vendorId: 'v-1',
        amount: 12,
        currency: 'GTQ',
        name: 'Lámpara Aurora',
      }),
    ).toEqual({
      offeringId: 'o-1',
      name: 'Lámpara Aurora',
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
    });
  });

  it('answers nothing for a missing record, one without a price, or one without a name', () => {
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
    // A line is sold under a name, so a record without one prices nothing.
    expect(
      publishedPriceOf('o-1', { vendorId: 'v-1', amount: 12, currency: 'GTQ' }),
    ).toBeUndefined();
    expect(
      publishedPriceOf('o-1', {
        vendorId: 'v-1',
        amount: 12,
        currency: 'GTQ',
        name: '',
      }),
    ).toBeUndefined();
  });
});
