import { Failure } from '@entifix/core';
import { Schema } from 'effect';

import { SaleUnits } from './sale-unit';

const fields = {
  offeringId: Schema.String,
  saleUnit: Schema.Literals(SaleUnits),
};

/**
 * Why a line's quantity is refused (ADR 0082 §3). Each names its offering,
 * because a checkout has many lines, and states quantities as the scaled
 * integers they are, beside the unit that says what they mean.
 */
export class QuantityUnreadable extends Failure.invalid<QuantityUnreadable>()(
  'QuantityUnreadable',
  'quantityUnreadable',
  fields,
  {
    message: ({ offeringId }) =>
      `the quantity asked of ${offeringId} is not a whole number in its scale`,
  },
) {}

export class QuantityBelowMinimum extends Failure.invalid<QuantityBelowMinimum>()(
  'QuantityBelowMinimum',
  'quantityBelowMinimum',
  { ...fields, minimum: Schema.Int },
  {
    message: ({ offeringId, saleUnit, minimum }) =>
      `${offeringId} sells no less than ${String(minimum)} in the scale of ${saleUnit}`,
  },
) {}

export class QuantityOffStep extends Failure.invalid<QuantityOffStep>()(
  'QuantityOffStep',
  'quantityOffStep',
  {
    ...fields,
    lower: Schema.Int,
    upper: Schema.Int,
  },
  {
    message: ({ offeringId, saleUnit, lower, upper }) =>
      `${offeringId} sells ${String(lower)} or ${String(upper)} in the scale of ${saleUnit}, and nothing between`,
  },
) {}

export class QuantityAboveMaximum extends Failure.invalid<QuantityAboveMaximum>()(
  'QuantityAboveMaximum',
  'quantityAboveMaximum',
  { ...fields, maximum: Schema.Int },
  {
    message: ({ offeringId, saleUnit, maximum }) =>
      `a line of ${offeringId} holds no more than ${String(maximum)} in the scale of ${saleUnit}`,
  },
) {}

/** A line whose total rounds to zero: it would be given away (ADR 0082 §6). */
export class LineBelowOneMinorUnit extends Failure.invalid<LineBelowOneMinorUnit>()(
  'LineBelowOneMinorUnit',
  'lineBelowOneMinorUnit',
  fields,
  {
    message: ({ offeringId }) =>
      `that quantity of ${offeringId} costs less than one minor unit`,
  },
) {}

export type SaleLineRefusal =
  | QuantityUnreadable
  | QuantityBelowMinimum
  | QuantityOffStep
  | QuantityAboveMaximum
  | LineBelowOneMinorUnit;
