import { describe, expect, it } from 'vitest';

import { quantityRefusal, saleLineRefusal } from './sale-line-refusal.js';
import { quantityMaximum, type SaleRule } from './sale-rule.js';

const byTheMetre: SaleRule = {
  saleUnit: 'M',
  quantityStep: 700,
  quantityMinimum: 1400,
};
const named = { offeringId: 'cable', saleUnit: 'M' };
const refusal = (quantity: number) =>
  quantityRefusal('cable', quantity, byTheMetre);

describe('quantityRefusal', () => {
  it.each([1400, 2100, quantityMaximum(byTheMetre)])('sells %i', quantity => {
    expect(refusal(quantity)).toBeUndefined();
  });

  it.each([Number.NaN, 2100.5])('refuses %s as unreadable', quantity => {
    const refused = refusal(quantity);
    expect(refused).toMatchObject({ code: 'quantityUnreadable', ...named });
    expect(refused?.message).toContain('cable');
  });

  it.each([0, -700, 700, 1399])('refuses %i as under the minimum', quantity => {
    const refused = refusal(quantity);
    expect(refused).toMatchObject({
      code: 'quantityBelowMinimum',
      ...named,
      minimum: 1400,
    });
    expect(refused?.message).toContain('1400');
  });

  it('refuses a quantity between steps and names the one on each side', () => {
    const refused = refusal(2500);
    expect(refused).toMatchObject({
      code: 'quantityOffStep',
      ...named,
      lower: 2100,
      upper: 2800,
    });
    expect(refused?.message).toContain('2100 or 2800');
  });

  it('names no neighbour past the maximum', () => {
    const maximum = quantityMaximum(byTheMetre);
    expect(refusal(maximum - 1)).toMatchObject({
      lower: maximum - 700,
      upper: maximum,
    });
  });

  it('refuses more than one line holds', () => {
    const refused = refusal(9_999_000);
    expect(refused).toMatchObject({
      code: 'quantityAboveMaximum',
      ...named,
      maximum: 9_998_800,
    });
    expect(refused?.message).toContain('9998800');
  });
});

describe('saleLineRefusal', () => {
  const price = { amount: 1250, pricePer: 1 } as const;

  it('sells a valid quantity that costs something', () => {
    expect(saleLineRefusal('cable', 2100, byTheMetre, price)).toBeUndefined();
  });

  it('answers the quantity first', () => {
    expect(saleLineRefusal('cable', 1, byTheMetre, price)).toMatchObject({
      code: 'quantityBelowMinimum',
    });
  });

  it('refuses a line that rounds to nothing', () => {
    const refused = saleLineRefusal('cable', 1400, byTheMetre, {
      amount: 1,
      pricePer: 1000,
    });
    expect(refused).toMatchObject({ code: 'lineBelowOneMinorUnit', ...named });
    expect(refused?.message).toContain('cable');
  });

  // A published offering is an entity: its price is read through accessors,
  // which a spread would drop.
  it('reads a price held behind accessors', () => {
    class Held {
      readonly #amount = 1;
      readonly #pricePer = 1000 as const;
      get amount() {
        return this.#amount;
      }
      get pricePer() {
        return this.#pricePer;
      }
    }
    expect(
      saleLineRefusal('cable', 1400, byTheMetre, new Held()),
    ).toMatchObject({ code: 'lineBelowOneMinorUnit' });
  });
});
