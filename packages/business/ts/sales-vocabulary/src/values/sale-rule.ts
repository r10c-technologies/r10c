import { oneWholeUnit, type SaleUnit } from './sale-unit';

/** The most whole units one line holds (ADR 0082 §3). */
export const MAX_WHOLE_UNITS_PER_LINE = 9_999;

/** How an offering is sold; step and minimum are in the unit's scale. */
export interface SaleRule {
  readonly saleUnit: SaleUnit;
  readonly quantityStep: number;
  readonly quantityMinimum: number;
}

/** A rule nobody narrowed: whole units, from one. What `set-sale-unit` resets to. */
export const defaultSaleRule = (saleUnit: SaleUnit): SaleRule => ({
  saleUnit,
  quantityStep: oneWholeUnit(saleUnit),
  quantityMinimum: oneWholeUnit(saleUnit),
});

/** The line maximum in the unit's scale, whatever the step. */
export const quantityLimit = (saleUnit: SaleUnit): number =>
  MAX_WHOLE_UNITS_PER_LINE * oneWholeUnit(saleUnit);

/** The largest quantity one line may ask: the last step inside the limit. */
export const quantityMaximum = (rule: SaleRule): number => {
  const limit = quantityLimit(rule.saleUnit);
  return limit - (limit % rule.quantityStep);
};

/**
 * Whether a rule can sell anything: positive integers, the minimum a multiple
 * of the step, and neither past what one line holds.
 */
export const isSellableRule = ({
  saleUnit,
  quantityStep,
  quantityMinimum,
}: SaleRule): boolean =>
  Number.isSafeInteger(quantityStep) &&
  Number.isSafeInteger(quantityMinimum) &&
  quantityStep > 0 &&
  quantityMinimum > 0 &&
  quantityMinimum % quantityStep === 0 &&
  quantityMinimum <= quantityLimit(saleUnit);
