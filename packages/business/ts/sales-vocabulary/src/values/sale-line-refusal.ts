import { lineTotal, type UnitPrice } from './line-total';
import {
  LineBelowOneMinorUnit,
  QuantityAboveMaximum,
  QuantityBelowMinimum,
  QuantityOffStep,
  QuantityUnreadable,
  type SaleLineRefusal,
} from './sale-quantity-failures';
import { quantityMaximum, type SaleRule } from './sale-rule';

/**
 * Why `quantity` of an offering cannot be sold under its rule, or `undefined`
 * when it can.
 *
 * ⚠️ **It refuses and never adjusts** (ADR 0082 §3): nothing here returns a
 * quantity to use instead, only the ones a message may offer.
 */
export const quantityRefusal = (
  offeringId: string,
  quantity: number,
  rule: SaleRule,
): SaleLineRefusal | undefined => {
  const { saleUnit, quantityStep, quantityMinimum } = rule;
  const named = { offeringId, saleUnit };
  if (!Number.isSafeInteger(quantity)) return new QuantityUnreadable(named);
  if (quantity < quantityMinimum)
    return new QuantityBelowMinimum({ ...named, minimum: quantityMinimum });
  const maximum = quantityMaximum(rule);
  if (quantity > maximum)
    return new QuantityAboveMaximum({ ...named, maximum });
  const over = quantity % quantityStep;
  if (over === 0) return undefined;
  return new QuantityOffStep({
    ...named,
    lower: quantity - over,
    upper: quantity - over + quantityStep,
  });
};

/**
 * Why a line cannot be sold at this price: its quantity, or a total that
 * rounds to nothing (ADR 0082 §6).
 */
export const saleLineRefusal = (
  offeringId: string,
  quantity: number,
  rule: SaleRule,
  price: UnitPrice,
): SaleLineRefusal | undefined => {
  const refused = quantityRefusal(offeringId, quantity, rule);
  if (refused !== undefined) return refused;
  // Named rather than spread: a published offering is an entity, whose
  // members are accessors a spread does not copy.
  return lineTotal({
    amount: price.amount,
    pricePer: price.pricePer,
    quantity,
    saleUnit: rule.saleUnit,
  }) === 0
    ? new LineBelowOneMinorUnit({ offeringId, saleUnit: rule.saleUnit })
    : undefined;
};
