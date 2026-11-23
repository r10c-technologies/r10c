/**
 * How each seeded offering is sold (ADR 0082) — the one answer the catalog
 * seed, the stock seed and the journeys that buy from them read, so an
 * offering sold by the metre is never stocked in pieces.
 *
 * Every offering is sold one piece at a time, priced for one, except two the
 * lab needs to show the other cases end to end: one by the half metre from a
 * metre, and one priced per hundred. Both are `published` in the catalog seed
 * (positions 1 and 5 of its status cycle), so they reach the storefront.
 *
 * Plain literals rather than the vocabulary's types: a utility sits below the
 * business layer, and `'M'` and `100` are already what those types admit.
 */
export interface SeededSaleTerms {
  readonly saleUnit: 'UN' | 'M';
  /** In the unit's scale: 500 is half a metre. */
  readonly quantityStep: number;
  readonly quantityMinimum: number;
  readonly pricePer: 1 | 100;
  /**
   * How many of the scale one whole unit is: 1000 for the metre. A seeded
   * stock count is written in whole units and scaled by this.
   */
  readonly wholeUnit: number;
}

/** The seeded offering sold by the metre: `product-offering-2`. */
export const SEEDED_BY_THE_METRE = 1;
/** The seeded offering priced per hundred: `product-offering-6`. */
export const SEEDED_PER_HUNDRED = 5;

const ONE_PIECE: SeededSaleTerms = {
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
  pricePer: 1,
  wholeUnit: 1,
};

/** How the seeded offering at catalog position `index` is sold. */
export const seededSaleTermsOf = (index: number): SeededSaleTerms => {
  switch (index) {
    case SEEDED_BY_THE_METRE:
      return {
        saleUnit: 'M',
        quantityStep: 500,
        quantityMinimum: 1000,
        pricePer: 1,
        wholeUnit: 1000,
      };
    case SEEDED_PER_HUNDRED:
      return { ...ONE_PIECE, pricePer: 100 };
    default:
      return ONE_PIECE;
  }
};
