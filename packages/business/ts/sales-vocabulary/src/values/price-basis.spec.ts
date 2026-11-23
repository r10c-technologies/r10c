import { describe, expect, it } from 'vitest';

import { quotedQuantity, UNECE_UNIT_CODES } from './price-basis.js';
import { SaleUnits } from './sale-unit.js';

describe('quotedQuantity', () => {
  it('says nothing for a price for one piece', () => {
    expect(quotedQuantity({ saleUnit: 'UN', pricePer: 1 })).toBeUndefined();
  });

  it.each([
    ['UN', 100, 100],
    ['M', 1, 1000],
    ['M', 100, 100_000],
    ['PAR', 1, 1],
  ] as const)(
    'reads %s per %i as %i in the unit’s scale',
    (saleUnit, pricePer, quantity) => {
      expect(quotedQuantity({ saleUnit, pricePer })).toEqual({
        saleUnit,
        quantity,
      });
    },
  );
});

describe('UNECE_UNIT_CODES', () => {
  it('names every unit once', () => {
    const codes = SaleUnits.map(unit => UNECE_UNIT_CODES[unit]);

    expect(new Set(codes).size).toBe(SaleUnits.length);
  });
});
