import { Failure } from '@entifix/core';
import { SaleUnits } from '@r10c/business-ts-sales-vocabulary';
import { Schema } from 'effect';

/**
 * A step and minimum that sell nothing: not positive whole numbers in the
 * unit's scale, a minimum that is no multiple of the step, or one past what a
 * line holds (ADR 0082 §3).
 */
export class SaleRuleInvalid extends Failure.invalid<SaleRuleInvalid>()(
  'SaleRuleInvalid',
  'saleRuleInvalid',
  {
    saleUnit: Schema.Literals(SaleUnits),
    quantityStep: Schema.Number,
    quantityMinimum: Schema.Number,
  },
  {
    message: ({ saleUnit, quantityStep, quantityMinimum }) =>
      `a step of ${String(quantityStep)} from ${String(quantityMinimum)} sells nothing in the scale of ${saleUnit}`,
  },
) {}

/** A price for some quantity other than one, a hundred or a thousand (§5). */
export class PricePerInvalid extends Failure.invalid<PricePerInvalid>()(
  'PricePerInvalid',
  'pricePerInvalid',
  { pricePer: Schema.Number },
  {
    message: ({ pricePer }) =>
      `a price is for 1, 100 or 1000 units, not ${String(pricePer)}`,
  },
) {}

/**
 * The unit of an offering that was ever published is fixed (§3): selling in
 * another unit is another offering.
 */
export class SaleUnitFixed extends Failure.conflict<SaleUnitFixed>()(
  'SaleUnitFixed',
  'saleUnitFixed',
  { id: Schema.String },
  {
    message: ({ id }) =>
      `offering ${id} was published, so its unit is fixed; create another offering to sell in another unit`,
  },
) {}
