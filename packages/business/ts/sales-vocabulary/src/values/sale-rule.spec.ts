import { describe, expect, it } from 'vitest';

import {
  defaultSaleRule,
  isSellableRule,
  quantityLimit,
  quantityMaximum,
} from './sale-rule.js';
import { SaleUnits } from './sale-unit.js';

const rule = (quantityStep: number, quantityMinimum: number) => ({
  saleUnit: 'M' as const,
  quantityStep,
  quantityMinimum,
});

describe('defaultSaleRule', () => {
  it('sells whole units from one', () => {
    expect(defaultSaleRule('M')).toEqual(rule(1000, 1000));
  });

  it.each(SaleUnits)('is sellable in %s', unit => {
    expect(isSellableRule(defaultSaleRule(unit))).toBe(true);
  });
});

describe('quantityMaximum', () => {
  it('is 9,999 whole units', () => {
    expect(quantityLimit('UN')).toBe(9999);
    expect(quantityMaximum(rule(500, 500))).toBe(9_999_000);
  });

  it('is the last step inside the limit when the step does not divide it', () => {
    expect(quantityMaximum(rule(700, 700))).toBe(9_998_800);
  });
});

describe('isSellableRule', () => {
  it.each([
    [500, 1000],
    [1, 1],
    [9_999_000, 9_999_000],
  ])('takes a step of %s from %s', (step, minimum) => {
    expect(isSellableRule(rule(step, minimum))).toBe(true);
  });

  it.each([
    [0, 1000],
    [-500, 1000],
    [500.5, 1001],
    [500, 1000.5],
    [500, 0],
    [500, 750],
    [1000, 10_000_000],
  ])('refuses a step of %s from %s', (step, minimum) => {
    expect(isSellableRule(rule(step, minimum))).toBe(false);
  });
});
