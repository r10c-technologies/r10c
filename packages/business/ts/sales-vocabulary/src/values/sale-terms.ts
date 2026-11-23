import { Schema } from 'effect';

import { isPricePer, type PricePer, PricePers } from './line-total';
import { isSellableRule, type SaleRule } from './sale-rule';
import { isSaleUnit, SaleUnits } from './sale-unit';

/**
 * Everything a buyer needs to ask for a quantity and know what it costs: the
 * offering's rule and how many whole units its price buys (ADR 0082 §1, §5).
 * A publication, the projection and the price a sale is charged from all
 * carry it whole, because any one member without the others misreads a
 * quantity or a price.
 */
export interface SaleTerms extends SaleRule {
  readonly pricePer: PricePer;
}

/**
 * The members of {@link SaleTerms} as schema fields, for a payload that
 * carries them beside its own. Shape only: whether the rule sells anything is
 * {@link isSellableRule}, which {@link saleTermsOf} applies.
 */
export const SaleTermsFields = {
  saleUnit: Schema.Literals(SaleUnits),
  quantityStep: Schema.Int,
  quantityMinimum: Schema.Int,
  pricePer: Schema.Literals(PricePers),
};

/**
 * The terms a stored or announced record states, or `undefined` when any
 * member is missing or the rule sells nothing. Never defaulted: an offering
 * read as `UN` because its unit was lost charges a metre as a unit.
 */
export const saleTermsOf = (
  record: Readonly<Record<string, unknown>> | undefined,
): SaleTerms | undefined => {
  const saleUnit = record?.['saleUnit'];
  const quantityStep = record?.['quantityStep'];
  const quantityMinimum = record?.['quantityMinimum'];
  const pricePer = record?.['pricePer'];
  if (
    !isSaleUnit(saleUnit) ||
    !isPricePer(pricePer) ||
    typeof quantityStep !== 'number' ||
    typeof quantityMinimum !== 'number'
  )
    return undefined;
  const rule = { saleUnit, quantityStep, quantityMinimum };
  return isSellableRule(rule) ? { ...rule, pricePer } : undefined;
};
