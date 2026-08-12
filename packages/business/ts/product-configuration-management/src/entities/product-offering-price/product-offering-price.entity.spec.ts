import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOfferingPrice } from './product-offering-price.entity.js';

describe('ProductOfferingPrice', () => {
  it('serializes the amount against its offering and currency', () => {
    const price = new ProductOfferingPrice('off-1', 1050, 'EUR');
    price.id = 'price-1';

    expect(serializeEntity(ProductOfferingPrice, price)).toEqual({
      id: 'price-1',
      offeringId: 'off-1',
      amount: 1050,
      currency: 'EUR',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const price = await Effect.runPromise(
      deserializeSingleEntity(ProductOfferingPrice, {
        id: 'price-2',
        offeringId: 'off-2',
        amount: 99,
        currency: 'USD',
      }),
    );

    expect(price?.amount).toBe(99);
    expect(price?.currency).toBe('USD');
  });

  it('starts at zero with no currency, which is not a sellable price', () => {
    const price = new ProductOfferingPrice();

    expect(price.offeringId).toBe('');
    expect(price.amount).toBe(0);
    expect(price.currency).toBe('');
  });

  it('accepts the setters a repository writes back through', () => {
    const price = new ProductOfferingPrice();
    price.offeringId = 'off-3';
    price.amount = 2500;
    price.currency = 'GBP';

    expect(price.offeringId).toBe('off-3');
    expect(price.amount).toBe(2500);
    expect(price.currency).toBe('GBP');
  });

  it('holds the amount as an integer minor unit, never a float', () => {
    // A binary float cannot represent 0.10 exactly, and money off by a rounding
    // error is money a settlement run reconciles by hand. 1050 EUR-cents is
    // €10.50 and survives every arithmetic the checkout performs on it.
    const price = new ProductOfferingPrice('off-4', 1050, 'EUR');

    expect(Number.isInteger(price.amount)).toBe(true);
    expect(price.amount * 3).toBe(3150);
  });

  it('leaves currency a plain string rather than a closed set', () => {
    // The closed sets in this repo select a storage boundary or a permission.
    // A currency selects neither, and narrowing it would mean a platform
    // release to accept a vendor's currency.
    const currency = describeEntityColumns(ProductOfferingPrice).find(
      column => column.name === 'currency',
    );

    expect(currency?.type).toBe('string');
    expect(currency?.enumValues).toBeUndefined();
  });
});
