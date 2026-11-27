import type { SampleProduct } from './types.js';

type Required = Pick<
  SampleProduct,
  | 'key'
  | 'name'
  | 'description'
  | 'brand'
  | 'category'
  | 'art'
  | 'amount'
  | 'status'
  | 'stock'
>;

/**
 * A product sold one piece at a time and priced for one, unless `rest` says
 * otherwise — what most rows in every sample store are, so each row states
 * only what is particular to it.
 */
export const product = (
  required: Required,
  rest: Partial<
    Pick<
      SampleProduct,
      | 'unit'
      | 'step'
      | 'minimum'
      | 'pricePer'
      | 'fits'
      | 'tiers'
      | 'drawsOn'
      | 'kit'
      | 'variant'
      | 'tone'
    >
  > = {},
): SampleProduct => ({
  unit: 'UN',
  step: 1,
  minimum: 1,
  pricePer: 1,
  ...required,
  ...rest,
});
