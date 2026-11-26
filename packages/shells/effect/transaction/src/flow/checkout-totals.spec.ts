import { describe, expect, it } from 'vitest';

import { pricedLine, pricedPart, totalsOf } from './checkout-totals.js';

/** 3.5 m of cable at Q45.00 the metre (ADR 0082). */
const CABLE = {
  offeringId: 'cable',
  saleUnit: 'M',
  quantity: 3500,
  amount: 4500,
  pricePer: 1,
  currency: 'GTQ',
};

/** 250 screws at Q7.50 the hundred. */
const SCREWS = {
  offeringId: 'screws',
  saleUnit: 'UN',
  quantity: 250,
  amount: 750,
  pricePer: 100,
  currency: 'GTQ',
};

describe('pricedLine', () => {
  it('states what a line costs, by its own terms', () => {
    expect(pricedLine(CABLE)).toEqual({ ...CABLE, lineTotal: 15_750 });
    expect(pricedLine(SCREWS)).toEqual({ ...SCREWS, lineTotal: 1875 });
  });

  it('overwrites the total a caller stated', () => {
    expect(pricedLine({ ...CABLE, lineTotal: 1 })).toMatchObject({
      lineTotal: 15_750,
    });
  });

  it.each([
    ['names no unit', { saleUnit: undefined }],
    ['names a basis no price is quoted on', { pricePer: 12 }],
    ['counts in a fraction', { quantity: 3.5 }],
    ['has a negative price', { amount: -1 }],
  ])(
    'states no total for a line that %s, dropping the caller’s',
    (_, change) => {
      expect(
        pricedLine({ ...CABLE, ...change, lineTotal: 15_750 }),
      ).not.toHaveProperty('lineTotal');
    },
  );
});

describe('a kit’s line', () => {
  /** Three kits of a case and two films, at Q150.00 each. */
  const KITS = {
    offeringId: 'kit',
    saleUnit: 'UN',
    quantity: 3,
    amount: 15_000,
    pricePer: 1,
    currency: 'GTQ',
    kitComponents: [
      {
        offeringId: 'case',
        quantity: 1,
        stockOfferingId: 'case',
        stockUnit: 'UN',
        stockQuantity: 1,
      },
      {
        offeringId: 'film',
        quantity: 2,
        stockOfferingId: 'film',
        stockUnit: 'UN',
        stockQuantity: 2,
      },
    ],
  };

  it('states what the whole line takes from each component, from what one kit takes', () => {
    expect(pricedLine(KITS)).toMatchObject({
      lineTotal: 45_000,
      kitComponents: [
        { offeringId: 'case', stockQuantity: 3 },
        { offeringId: 'film', stockQuantity: 6 },
      ],
    });
  });

  it('holds no components for a partial kit, or one not sold by the unit', () => {
    expect(
      pricedLine({ ...KITS, kitComponents: [{ offeringId: 'case' }] }),
    ).not.toHaveProperty('kitComponents');
    expect(
      pricedLine({ ...KITS, saleUnit: 'M', quantity: 3000 }),
    ).not.toHaveProperty('kitComponents');
  });
});

describe('a presentation’s line', () => {
  /** Two 100 m rolls of the cable, at Q4,000.00 each. */
  const ROLLS = {
    offeringId: 'roll',
    saleUnit: 'UN',
    quantity: 2,
    amount: 400_000,
    pricePer: 1,
    currency: 'GTQ',
    stockOfferingId: 'cable',
    stockFactor: 100_000,
    stockUnit: 'M',
  };

  it('states what it takes from its base, in the base’s unit, and drops the factor', () => {
    const { stockFactor: _, ...kept } = ROLLS;

    expect(pricedLine({ ...ROLLS, stockQuantity: 1 })).toEqual({
      ...kept,
      lineTotal: 800_000,
      stockQuantity: 200_000,
    });
  });

  it.each([
    ['names no whole source', { stockUnit: 'BOX' }],
    ['is not sold by the unit', { saleUnit: 'M', quantity: 2000 }],
  ])('takes nothing from a base when it %s', (_, change) => {
    const priced = pricedLine({ ...ROLLS, ...change, stockQuantity: 5 });

    expect(priced).not.toHaveProperty('stockOfferingId');
    expect(priced).not.toHaveProperty('stockQuantity');
  });
});

describe('pricedPart', () => {
  it('prices every line of a part, and leaves a part with no lines alone', () => {
    expect(
      pricedPart({ vendorId: 'v-1', lines: [CABLE, 'not a line'] }),
    ).toEqual({
      vendorId: 'v-1',
      lines: [{ ...CABLE, lineTotal: 15_750 }, {}],
    });
    expect(pricedPart({ vendorId: 'v-1' })).toEqual({ vendorId: 'v-1' });
  });
});

describe('totalsOf', () => {
  it('sums the stated totals per currency, across parts', () => {
    expect(
      totalsOf([
        pricedPart({ lines: [CABLE] }),
        pricedPart({ lines: [SCREWS, { ...SCREWS, currency: 'USD' }] }),
        { lines: 'none' },
        // A line with no total adds nothing: its decoding refuses it.
        { lines: [{ currency: 'GTQ' }, null] },
      ]),
    ).toEqual([
      { currency: 'GTQ', amount: 17_625 },
      { currency: 'USD', amount: 1875 },
    ]);
  });
});
