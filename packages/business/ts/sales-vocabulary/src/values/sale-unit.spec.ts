import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SALE_UNIT,
  formatQuantity,
  isSaleUnit,
  oneWholeUnit,
  parseQuantity,
  SaleUnits,
  saleUnitScale,
} from './sale-unit.js';

describe('SaleUnits', () => {
  it('counts pieces and pairs whole and measures everything else in thousandths', () => {
    expect(SaleUnits.filter(unit => saleUnitScale(unit) === 0)).toEqual([
      'UN',
      'PAR',
    ]);
    expect(SaleUnits.filter(unit => saleUnitScale(unit) === 3)).toEqual([
      'M',
      'YD',
      'FT',
      'M2',
      'FT2',
      'DM2',
      'KG',
      'LB',
      'L',
      'GAL',
    ]);
  });

  it.each(SaleUnits)('%s fits the FEL UnidadMedida', unit => {
    expect(unit.length).toBeLessThanOrEqual(3);
  });

  it('defaults to a piece', () => {
    expect(DEFAULT_SALE_UNIT).toBe('UN');
  });

  it.each(SaleUnits)('accepts %s', unit => {
    expect(isSaleUnit(unit)).toBe(true);
  });

  it.each(['CAJA', 'm', 'toString', undefined, 7])('rejects %s', value => {
    expect(isSaleUnit(value)).toBe(false);
  });

  it('counts one whole unit in its scale', () => {
    expect([oneWholeUnit('UN'), oneWholeUnit('M')]).toEqual([1, 1000]);
  });
});

describe('parseQuantity', () => {
  it.each([
    ['3.5', 'M', 3500],
    ['3,5', 'M', 3500],
    ['0.137', 'M', 137],
    ['3500', 'UN', 3500],
  ] as const)('reads %s %s as %i', (text, unit, quantity) => {
    expect(parseQuantity(text, unit, 'en')).toBe(quantity);
  });

  it.each([
    ['3.5', 'UN'],
    ['3.5001', 'M'],
    ['tres', 'M'],
  ] as const)('refuses %s %s rather than rounding it', (text, unit) => {
    expect(parseQuantity(text, unit, 'en')).toBeUndefined();
  });
});

describe('formatQuantity', () => {
  it('writes a quantity in its unit, not the stored integer', () => {
    expect(formatQuantity(3500, 'M', 'en')).toBe('3.5');
    expect(formatQuantity(3500, 'UN', 'en')).toBe('3,500');
  });

  it.each(SaleUnits)('reads back the text it gives to edit in %s', unit => {
    for (const quantity of [0, 1, 5, 137, 999, 1000, 3500, 9_999_000]) {
      const text = formatQuantity(quantity, unit, 'en', { grouping: false });
      expect(parseQuantity(text, unit, 'en')).toBe(quantity);
    }
  });
});
