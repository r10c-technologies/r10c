import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { describe, expect, it } from 'vitest';

import { pricedCartOf, reviewedTotalsOf } from './priced-cart-state';

const offering = (
  offeringId: string,
  vendorId: string,
  amount: number,
  currency = 'GTQ',
) =>
  Object.assign(new PublishedOffering(offeringId, vendorId, offeringId), {
    amount,
    currency,
  });

describe('pricedCartOf', () => {
  it('prices each line, splits it per seller and sums one total per currency', () => {
    const cart = pricedCartOf([
      {
        line: { offeringId: 'o-1', quantity: 2 },
        offering: offering('o-1', 'v-1', 500),
      },
      {
        line: { offeringId: 'o-2', quantity: 1 },
        offering: offering('o-2', 'v-2', 900),
      },
      {
        line: { offeringId: 'o-3', quantity: 1 },
        offering: offering('o-3', 'v-1', 100, 'USD'),
      },
    ]);

    expect(cart.parts.map(part => part.vendorId)).toEqual(['v-1', 'v-2']);
    // Each line is sold under the offering's published name (#582).
    expect(cart.priced.map(line => line.name)).toEqual(['o-1', 'o-2', 'o-3']);
    expect(cart.totals).toEqual([
      { currency: 'GTQ', amount: 1900 },
      { currency: 'USD', amount: 100 },
    ]);
    expect(cart.offerings.get('o-2')?.vendorId).toBe('v-2');
    expect(cart.unavailable).toBe(0);
  });

  it('copies the description and the version each line is sold under', () => {
    const pinned = Object.assign(offering('o-1', 'v-1', 500), {
      description: 'Esmaltada a mano.',
      specificationId: 'spec-1',
      specificationVersion: 3,
    });
    const blank = Object.assign(offering('o-2', 'v-1', 500), {
      description: '',
    });

    const [first, second] = pricedCartOf([
      { line: { offeringId: 'o-1', quantity: 1 }, offering: pinned },
      { line: { offeringId: 'o-2', quantity: 1 }, offering: blank },
    ]).priced;

    // ADR 0079 §3: after placement nothing on a line is resolved by reference.
    expect(first).toMatchObject({
      description: 'Esmaltada a mano.',
      specificationId: 'spec-1',
      specificationVersion: 3,
    });
    // A row with no pin predates the widening; the checkout's schema refuses it.
    expect(second).not.toHaveProperty('description');
    expect(second).toMatchObject({
      specificationId: '',
      specificationVersion: 0,
    });
  });

  it('drops and counts a line whose offering is no longer published', () => {
    const cart = pricedCartOf([
      {
        line: { offeringId: 'o-1', quantity: 1 },
        offering: offering('o-1', 'v-1', 500),
      },
      { line: { offeringId: 'gone', quantity: 3 }, offering: undefined },
    ]);

    expect(cart.present.map(({ line }) => line.offeringId)).toEqual(['o-1']);
    expect(cart.totals).toEqual([{ currency: 'GTQ', amount: 500 }]);
    expect(cart.unavailable).toBe(1);
  });
});

describe('reviewedTotalsOf', () => {
  it('states every currency, so a moved price or a dropped line changes it', () => {
    expect(
      reviewedTotalsOf([
        { currency: 'GTQ', amount: 1900 },
        { currency: 'USD', amount: 100 },
      ]),
    ).toBe('GTQ:1900;USD:100');
    expect(reviewedTotalsOf([])).toBe('');
  });
});
