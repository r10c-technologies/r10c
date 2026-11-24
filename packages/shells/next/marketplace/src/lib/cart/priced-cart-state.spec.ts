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
    // One piece at a time, priced for one (ADR 0082): a projection row
    // always states its terms.
    saleUnit: 'UN',
    quantityStep: 1,
    quantityMinimum: 1,
    pricePer: 1,
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

  it('charges the whole line the volume price its quantity reaches, and says where it starts', () => {
    const tiered = Object.assign(offering('o-1', 'v-1', 500), {
      tiers: [{ from: 10, amount: 400 }],
    });

    const [below] = pricedCartOf([
      { line: { offeringId: 'o-1', quantity: 9 }, offering: tiered },
    ]).priced;
    const [reached] = pricedCartOf([
      { line: { offeringId: 'o-1', quantity: 10 }, offering: tiered },
    ]).priced;

    expect(below).toMatchObject({ amount: 500, lineTotal: 4500 });
    expect(below).not.toHaveProperty('tierFrom');
    // Ten cost less than nine: the whole line steps down (ADR 0082 §8).
    expect(reached).toMatchObject({
      amount: 400,
      tierFrom: 10,
      lineTotal: 4000,
    });
  });

  it('states the base a presentation draws on, and none for a plain offering', () => {
    const roll = Object.assign(offering('roll', 'v-1', 400_000), {
      stockOfferingId: 'cable',
      stockFactor: 100_000,
      stockUnit: 'M',
    });

    const [drawn, plain] = pricedCartOf([
      { line: { offeringId: 'roll', quantity: 2 }, offering: roll },
      {
        line: { offeringId: 'o-2', quantity: 1 },
        offering: offering('o-2', 'v-1', 9),
      },
    ]).priced;

    expect(drawn).toMatchObject({
      stockOfferingId: 'cable',
      stockFactor: 100_000,
      stockUnit: 'M',
    });
    expect(plain).not.toHaveProperty('stockOfferingId');
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

  it('names a line its offering’s terms no longer sell, and passes the rest', () => {
    // Sold by the metre now: the 1.5 m added under a half-metre step is off it.
    const cable = Object.assign(offering('cable', 'v-1', 4500), {
      saleUnit: 'M',
      quantityStep: 1000,
      quantityMinimum: 1000,
    });

    const cart = pricedCartOf([
      { line: { offeringId: 'cable', quantity: 1500 }, offering: cable },
      {
        line: { offeringId: 'o-1', quantity: 2 },
        offering: offering('o-1', 'v-1', 500),
      },
    ]);

    expect([...cart.refusals]).toEqual([['cable', 'quantityOffStep']]);
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
