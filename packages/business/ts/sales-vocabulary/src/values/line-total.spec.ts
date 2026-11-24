import { describe, expect, it } from 'vitest';

import {
  amountPerThousand,
  DEFAULT_PRICE_PER,
  isPricePer,
  lineTotal,
  PricePers,
  stockQuantityOf,
} from './line-total.js';
import { quantityLimit } from './sale-rule.js';
import { oneWholeUnit, SaleUnits } from './sale-unit.js';

/** A seeded generator, so a failing case is the same case on every run. */
const generator = (seed: number) => () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed / 2 ** 32;
};

describe('PricePers', () => {
  it('is one, a hundred or a thousand, and one by default', () => {
    expect(PricePers).toEqual([1, 100, 1000]);
    expect(DEFAULT_PRICE_PER).toBe(1);
  });

  it.each(PricePers)('accepts %s', value => {
    expect(isPricePer(value)).toBe(true);
  });

  it.each([0, 10, '100', undefined])('rejects %s', value => {
    expect(isPricePer(value)).toBe(false);
  });
});

describe('lineTotal', () => {
  it.each([
    ['2 pieces at Q40', 4000, 1, 2, 'UN', 8000],
    ['3.5 m at Q12.50', 1250, 1, 3500, 'M', 4375],
    ['250 screws at Q7.50 the hundred', 750, 100, 250, 'UN', 1875],
    ['half a centavo rounds up', 1, 1, 500, 'M', 1],
    ['less than half rounds to nothing', 1, 1, 499, 'M', 0],
  ] as const)('%s', (_, amount, pricePer, quantity, saleUnit, total) => {
    expect(lineTotal({ amount, pricePer, quantity, saleUnit })).toBe(total);
  });

  it('is the exact product rounded half up, so FEL accepts it within its centavo', () => {
    const next = generator(672);
    for (let run = 0; run < 100_000; run += 1) {
      const saleUnit =
        SaleUnits.at(Math.floor(next() * SaleUnits.length)) ?? 'UN';
      const pricePer = PricePers.at(Math.floor(next() * PricePers.length)) ?? 1;
      const amount = Math.floor(next() * 10 ** (1 + Math.floor(next() * 8)));
      const quantity = 1 + Math.floor(next() * quantityLimit(saleUnit));

      const total = BigInt(lineTotal({ amount, pricePer, quantity, saleUnit }));

      const exact = BigInt(amount) * BigInt(quantity);
      const per = BigInt(pricePer) * BigInt(oneWholeUnit(saleUnit));
      const error = 2n * (total * per - exact);
      // Never more than half a minor unit away, and up on the half.
      if (error > per || error <= -per)
        expect.fail(
          `${String(amount)}/${String(pricePer)} x ${String(quantity)} ${saleUnit} = ${String(total)}`,
        );
    }
  });

  it('keeps the last centavo where a float would lose it', () => {
    expect(
      lineTotal({
        amount: 900_719_925_473,
        pricePer: 1,
        quantity: 9_999_000,
        saleUnit: 'M',
      }),
    ).toBe(9_006_298_534_804_527);
  });

  it.each(SaleUnits)(
    'stays exact for the dearest whole line in %s',
    saleUnit => {
      const amount = Math.floor(Number.MAX_SAFE_INTEGER / 9999);
      const quantity = quantityLimit(saleUnit);
      expect(
        BigInt(lineTotal({ amount, pricePer: 1, quantity, saleUnit })),
      ).toBe(BigInt(amount) * 9999n);
    },
  );

  it('throws rather than state an amount it cannot hold', () => {
    expect(() =>
      lineTotal({
        amount: Number.MAX_SAFE_INTEGER,
        pricePer: 1,
        quantity: 2,
        saleUnit: 'UN',
      }),
    ).toThrow(RangeError);
  });

  it.each([1.5, -1, Number.NaN])('throws on a quantity of %s', quantity => {
    expect(() =>
      lineTotal({ amount: 100, pricePer: 1, quantity, saleUnit: 'UN' }),
    ).toThrow(RangeError);
  });
});

describe('amountPerThousand', () => {
  it.each([
    [750, 1, 750_000],
    [750, 100, 7500],
    [750, 1000, 750],
  ] as const)('%i per %i orders as %i', (amount, pricePer, key) => {
    expect(amountPerThousand({ amount, pricePer })).toBe(key);
  });
});

describe('stockQuantityOf', () => {
  it('draws the factor once per presentation sold', () => {
    expect(
      stockQuantityOf({ quantity: 3, saleUnit: 'UN', stockFactor: 100_000 }),
    ).toBe(300_000);
  });

  it('refuses a presentation sold in anything but UN', () => {
    expect(() =>
      stockQuantityOf({ quantity: 3, saleUnit: 'M', stockFactor: 100 }),
    ).toThrow(RangeError);
  });

  it.each([0, -5])('refuses a factor of %i', stockFactor => {
    expect(() =>
      stockQuantityOf({ quantity: 3, saleUnit: 'UN', stockFactor }),
    ).toThrow(RangeError);
  });

  it('refuses a quantity it cannot count', () => {
    expect(() =>
      stockQuantityOf({ quantity: 1.5, saleUnit: 'UN', stockFactor: 2 }),
    ).toThrow(RangeError);
  });
});
