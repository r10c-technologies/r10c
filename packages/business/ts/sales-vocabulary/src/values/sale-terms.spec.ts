import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { SaleTermsFields, saleTermsOf } from './sale-terms.js';

const METRE = {
  saleUnit: 'M',
  quantityStep: 500,
  quantityMinimum: 1000,
  pricePer: 1,
};

describe('saleTermsOf', () => {
  it('reads the terms a record states', () => {
    expect(saleTermsOf({ ...METRE, name: 'Cable' })).toEqual(METRE);
  });

  it('reads nothing from no record', () => {
    expect(saleTermsOf(undefined)).toBeUndefined();
  });

  it.each([
    ['an unknown unit', { saleUnit: 'BOX' }],
    ['an unknown price basis', { pricePer: 12 }],
    ['a step that is not a number', { quantityStep: '500' }],
    ['a minimum that is not a number', { quantityMinimum: undefined }],
    ['a rule that sells nothing', { quantityMinimum: 750 }],
  ])('refuses %s rather than defaulting it', (_, change) => {
    expect(saleTermsOf({ ...METRE, ...change })).toBeUndefined();
  });
});

describe('SaleTermsFields', () => {
  const decode = Schema.decodeUnknownSync(Schema.Struct(SaleTermsFields));

  it('accepts the terms', () => {
    expect(decode(METRE)).toEqual(METRE);
  });

  it('refuses a unit outside the vocabulary', () => {
    expect(() => decode({ ...METRE, saleUnit: 'BOX' })).toThrow();
  });

  it('refuses a fractional step', () => {
    expect(() => decode({ ...METRE, quantityStep: 0.5 })).toThrow();
  });
});
