import { describe, expect, it } from 'vitest';

import {
  SEEDED_BY_THE_METRE,
  SEEDED_PER_HUNDRED,
  seededSaleTermsOf,
} from './seeded-sale-terms.js';

const MEASURED = { measured: true };

describe('seededSaleTermsOf', () => {
  it('sells one offering by the half metre from a metre', () => {
    expect(seededSaleTermsOf(MEASURED, SEEDED_BY_THE_METRE)).toEqual({
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
      pricePer: 1,
      wholeUnit: 1000,
    });
  });

  it('prices one per hundred, sold by the piece', () => {
    expect(seededSaleTermsOf(MEASURED, SEEDED_PER_HUNDRED)).toMatchObject({
      saleUnit: 'UN',
      quantityStep: 1,
      pricePer: 100,
    });
  });

  it('sells every other one a piece at a time, priced for one', () => {
    expect(seededSaleTermsOf(MEASURED, 0)).toEqual({
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
      pricePer: 1,
      wholeUnit: 1,
    });
  });

  it('sells everything of a vendor that is not measured by the piece', () => {
    expect(
      seededSaleTermsOf({ measured: false }, SEEDED_BY_THE_METRE),
    ).toMatchObject({ saleUnit: 'UN', pricePer: 1 });
  });
});
