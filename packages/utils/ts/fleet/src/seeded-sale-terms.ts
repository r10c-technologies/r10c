/**
 * How each seeded offering is sold (ADR 0082) — the one answer the catalog
 * seed, the stock seed and the journeys that buy from them read, so an
 * offering sold by the metre is never stocked in pieces.
 *
 * Every offering is sold one piece at a time, priced for one, except two of a
 * `measured` vendor's that the lab needs to show the other cases end to end:
 * one by the half metre from a metre, and one priced per hundred. Both sit
 * where the catalog seed's cycles make an offering `published`, priced in
 * GTQ and stocked, so they reach the storefront and can be bought.
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
   * What one seeded stock count is, in the scale: a metre (1000) for the
   * cable, a hundred (100) for the part sold by the hundred, one piece for
   * the rest — so stock is counted the way the goods are bought.
   */
  readonly stockCount: number;
}

/** The seeded offering sold by the metre: `product-offering-10`. */
export const SEEDED_BY_THE_METRE = 9;
/** The seeded offering priced per hundred: `product-offering-22`. */
export const SEEDED_PER_HUNDRED = 21;

const ONE_PIECE: SeededSaleTerms = {
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
  pricePer: 1,
  stockCount: 1,
};

/** How `vendor`'s seeded offering at catalog position `index` is sold. */
export const seededSaleTermsOf = (
  vendor: { readonly measured: boolean },
  index: number,
): SeededSaleTerms => {
  if (!vendor.measured) return ONE_PIECE;
  switch (index) {
    case SEEDED_BY_THE_METRE:
      return {
        saleUnit: 'M',
        quantityStep: 500,
        quantityMinimum: 1000,
        pricePer: 1,
        stockCount: 1000,
      };
    case SEEDED_PER_HUNDRED:
      return { ...ONE_PIECE, pricePer: 100, stockCount: 100 };
    default:
      return ONE_PIECE;
  }
};
