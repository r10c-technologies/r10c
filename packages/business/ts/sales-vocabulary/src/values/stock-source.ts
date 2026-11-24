import { Failure } from '@entifix/core';
import { Schema } from 'effect';

import { isSaleUnit, type SaleUnit } from './sale-unit';

/**
 * Where a presentation's stock comes from (ADR 0082 §7): a box, a roll or a
 * dozen is an offering of its own, sold in `UN`, that draws `stockFactor`
 * scaled base quantities from `stockOfferingId`'s stock per one sold.
 *
 * `stockUnit` is the base's unit, read when the presentation is published: the
 * ledger refuses a hold in any other unit, and the coordinator that reserves
 * reads no catalog, so the unit has to ride the line.
 */
export interface StockSource {
  readonly stockOfferingId: string;
  readonly stockFactor: number;
  readonly stockUnit: SaleUnit;
}

/** The unit a presentation is sold in. */
export const PRESENTATION_UNIT: SaleUnit = 'UN';

export const StockSourceProblems = [
  'notCounted',
  'factor',
  'self',
  'baseMissing',
  'baseIsPresentation',
  'isBase',
] as const;

export type StockSourceProblem = (typeof StockSourceProblems)[number];

/**
 * A stock source that cannot be drawn on: the presentation is not sold in
 * `UN`, the factor is not a positive count, the base is the offering itself,
 * missing, or a presentation already, or the offering is already a base for
 * another — one level only.
 */
export class StockSourceInvalid extends Failure.invalid<StockSourceInvalid>()(
  'StockSourceInvalid',
  'stockSourceInvalid',
  { problem: Schema.Literals(StockSourceProblems) },
  { message: ({ problem }) => `stock source is refused: ${problem}` },
) {}

/** Whether `value` can be a factor: a positive safe integer. */
export const isStockFactor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * The stock source a stored, announced or stated record holds, or `undefined`
 * when it holds none or not a whole one. Shape only.
 */
export const stockSourceOf = (record: {
  readonly [key: string]: unknown;
}): StockSource | undefined => {
  const { stockOfferingId, stockFactor, stockUnit } = record;
  return typeof stockOfferingId === 'string' &&
    stockOfferingId.length > 0 &&
    isStockFactor(stockFactor) &&
    isSaleUnit(stockUnit)
    ? { stockOfferingId, stockFactor, stockUnit }
    : undefined;
};
