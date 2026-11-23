import type { PricePer } from './line-total';
import { DEFAULT_SALE_UNIT, oneWholeUnit, type SaleUnit } from './sale-unit';

/** What a quoted price is for: a unit, and how many whole ones (ADR 0082 §5). */
export interface PriceBasis {
  readonly saleUnit: SaleUnit;
  readonly pricePer: PricePer;
}

/**
 * The quantity a price buys, in the unit's scale, for a reader to be told
 * beside it — or `undefined` for one piece, which is what a bare price has
 * always meant and so needs no words. `M` at `100` is `100000`: a hundred
 * metres.
 */
export const quotedQuantity = ({
  saleUnit,
  pricePer,
}: PriceBasis):
  { readonly saleUnit: SaleUnit; readonly quantity: number } | undefined =>
  saleUnit === DEFAULT_SALE_UNIT && pricePer === 1
    ? undefined
    : { saleUnit, quantity: pricePer * oneWholeUnit(saleUnit) };

/**
 * Each unit's UN/ECE Recommendation 20 code: what schema.org's `unitCode`
 * names a quantity in, so a search engine reads Q7.50 the hundred as that and
 * not as Q7.50 each.
 */
export const UNECE_UNIT_CODES: Readonly<Record<SaleUnit, string>> = {
  UN: 'H87',
  PAR: 'PR',
  M: 'MTR',
  YD: 'YRD',
  FT: 'FOT',
  M2: 'MTK',
  FT2: 'FTK',
  DM2: 'DMK',
  KG: 'KGM',
  LB: 'LBR',
  L: 'LTR',
  GAL: 'GLL',
};
