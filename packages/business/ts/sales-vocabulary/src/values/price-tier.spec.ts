import { describe, expect, it } from 'vitest';

import { lineTotal } from './line-total.js';
import {
  MAX_PRICE_TIERS,
  priceTiersOf,
  priceTiersRefusal,
  tieredPrice,
} from './price-tier.js';
import type { SaleRule } from './sale-rule.js';

const metres: SaleRule = {
  saleUnit: 'M',
  quantityStep: 500,
  quantityMinimum: 1000,
};
const base = { amount: 1250, pricePer: 1 } as const;
const tiers = [
  { from: 10_000, amount: 1100 },
  { from: 50_000, amount: 950 },
];

describe('tieredPrice', () => {
  it('charges the base price below the first tier', () => {
    expect(tieredPrice({ ...base, tiers }, 9500)).toEqual({ amount: 1250 });
  });

  it('charges the whole line at the highest tier reached', () => {
    expect(tieredPrice({ ...base, tiers }, 10_000)).toEqual({
      amount: 1100,
      tierFrom: 10_000,
    });
    expect(tieredPrice({ ...base, tiers }, 49_500)).toEqual({
      amount: 1100,
      tierFrom: 10_000,
    });
    expect(tieredPrice({ ...base, tiers }, 50_000)).toEqual({
      amount: 950,
      tierFrom: 50_000,
    });
  });

  it('charges the base price when there are no tiers', () => {
    expect(tieredPrice(base, 99_000)).toEqual({ amount: 1250 });
  });

  it('can make a larger quantity cost less than a slightly smaller one', () => {
    const total = (quantity: number) =>
      lineTotal({
        ...base,
        amount: tieredPrice({ ...base, tiers }, quantity).amount,
        quantity,
        saleUnit: 'M',
      });
    expect(total(10_000)).toBeLessThan(total(9500));
  });

  it('never charges more than a smaller quantity of the same tiers would at its own tier, sweeping every quantity', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let quantity = 1000; quantity <= 60_000; quantity += 500) {
      const { amount } = tieredPrice({ ...base, tiers }, quantity);
      expect(amount).toBeLessThanOrEqual(previous);
      previous = amount;
    }
  });
});

describe('priceTiersRefusal', () => {
  it('accepts no tiers and valid tiers', () => {
    expect(priceTiersRefusal([], base, metres)).toBeUndefined();
    expect(priceTiersRefusal(tiers, base, metres)).toBeUndefined();
  });

  it.each([
    [
      'a quantity off the step',
      [{ from: 10_200, amount: 1100 }],
      0,
      'quantity',
    ],
    [
      'a quantity past the line maximum',
      [{ from: 99_999_000, amount: 1100 }],
      0,
      'quantity',
    ],
    [
      'a tier at the minimum, which is the base price',
      [{ from: 1000, amount: 1100 }],
      0,
      'notAscending',
    ],
    ['tiers out of order', [tiers[1], tiers[0]], 1, 'notAscending'],
    [
      'a tier no cheaper than the base',
      [{ from: 10_000, amount: 1250 }],
      0,
      'notCheaper',
    ],
    [
      'a tier no cheaper than the one before',
      [tiers[0], { from: 50_000, amount: 1100 }],
      1,
      'notCheaper',
    ],
    ['a fractional amount', [{ from: 10_000, amount: 10.5 }], 0, 'notCheaper'],
    [
      'a negative amount',
      [{ from: 10_000, amount: -1 }],
      0,
      'belowOneMinorUnit',
    ],
    [
      'an amount given away at its own from',
      [{ from: 10_000, amount: 0 }],
      0,
      'belowOneMinorUnit',
    ],
  ] as const)('refuses %s', (_, refused, index, problem) => {
    expect(priceTiersRefusal(refused, base, metres)).toMatchObject({
      code: 'priceTiersInvalid',
      index,
      problem,
    });
  });

  it('says which tier and why in its message', () => {
    expect(
      priceTiersRefusal([{ from: 1000, amount: 1100 }], base, metres)?.message,
    ).toBe('price tier 0 is refused: notAscending');
  });

  it('refuses more tiers than a buyer can read', () => {
    const many = Array.from({ length: MAX_PRICE_TIERS + 1 }, (_, i) => ({
      from: 2000 + i * 1000,
      amount: 1200 - i * 10,
    }));
    expect(priceTiersRefusal(many, base, metres)).toMatchObject({
      problem: 'tooMany',
    });
  });

  it('reads the base under its own pricePer', () => {
    const perHundred = { amount: 750, pricePer: 100 } as const;
    const pieces: SaleRule = {
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
    };
    expect(
      priceTiersRefusal([{ from: 1000, amount: 600 }], perHundred, pieces),
    ).toBeUndefined();
  });
});

describe('priceTiersOf', () => {
  it('reads tiers', () => {
    expect(priceTiersOf(tiers)).toEqual(tiers);
  });

  it.each([
    undefined,
    [],
    'x',
    [null],
    [{ from: 1 }],
    [{ from: 1.5, amount: 2 }],
  ])('reads %j as none', value => {
    expect(priceTiersOf(value)).toBeUndefined();
  });
});
