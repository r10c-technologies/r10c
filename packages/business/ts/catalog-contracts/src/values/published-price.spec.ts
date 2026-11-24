import { describe, expect, it } from 'vitest';

import { publishedPriceOf } from './published-price.js';

describe('publishedPriceOf', () => {
  const PIN = { specificationId: 's-1', specificationVersion: 2 };
  const TERMS = {
    saleUnit: 'M',
    quantityStep: 500,
    quantityMinimum: 1000,
    pricePer: 100,
  } as const;

  it('reads the vendor, the name, the unit price and the version off a published record', () => {
    expect(
      publishedPriceOf('o-1', {
        vendorId: 'v-1',
        amount: 12,
        currency: 'GTQ',
        name: 'Lámpara Aurora',
        ...TERMS,
        description: 'De bronce.',
        ...PIN,
      }),
    ).toEqual({
      offeringId: 'o-1',
      name: 'Lámpara Aurora',
      ...TERMS,
      description: 'De bronce.',
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
      ...PIN,
      ...TERMS,
    });
  });

  it('reads the tiers the price steps down by, and none when it has none', () => {
    const record = {
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
      name: 'Lámpara Aurora',
      ...TERMS,
      ...PIN,
    };
    const tiers = [{ from: 10_000, amount: 10 }];

    expect(publishedPriceOf('o-1', { ...record, tiers })?.tiers).toEqual(tiers);
    expect(publishedPriceOf('o-1', record)).not.toHaveProperty('tiers');
  });

  it('omits a blank or absent description rather than copying it', () => {
    const record = {
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
      name: 'Lámpara Aurora',
      ...TERMS,
      ...PIN,
    };

    expect(publishedPriceOf('o-1', record)).not.toHaveProperty('description');
    expect(
      publishedPriceOf('o-1', { ...record, description: '' }),
    ).not.toHaveProperty('description');
  });

  it('answers nothing for a record that names no specification version', () => {
    const record = {
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
      name: 'Lámpara Aurora',
      ...TERMS,
    };

    expect(
      publishedPriceOf('o-1', { ...record, specificationVersion: 1 }),
    ).toBeUndefined();
    expect(
      publishedPriceOf('o-1', { ...record, ...PIN, specificationId: '' }),
    ).toBeUndefined();
    expect(
      publishedPriceOf('o-1', { ...record, ...PIN, specificationVersion: '1' }),
    ).toBeUndefined();
  });

  it('answers nothing for a record without its sale terms, rather than pricing one unit', () => {
    const record = {
      vendorId: 'v-1',
      amount: 12,
      currency: 'GTQ',
      name: 'Lámpara Aurora',
      ...PIN,
    };

    expect(publishedPriceOf('o-1', record)).toBeUndefined();
    expect(
      publishedPriceOf('o-1', { ...record, ...TERMS, pricePer: 12 }),
    ).toBeUndefined();
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
