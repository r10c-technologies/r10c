import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/** The longest SKU a vendor may give an offering. */
export const SKU_MAX_LENGTH = 40;

/**
 * What a SKU may be made of: letters, digits and `. _ / -`. That is what a
 * barcode prints and a scanner types, and what a sheet cell keeps without
 * quoting. No space, so a code read off a label is never two codes.
 */
const SKU_PATTERN = /^[A-Za-z0-9._/-]+$/;

export const SKU_INVALID = 'skuInvalid';

/** A SKU that is too long or holds a character a label would not print. */
export class SkuInvalid extends Failure.invalid<SkuInvalid>()(
  'SkuInvalid',
  SKU_INVALID,
  { sku: Schema.String },
  {
    message: ({ sku }) =>
      `a SKU is 1 to ${String(SKU_MAX_LENGTH)} letters, digits or . _ / -; "${sku}" is not`,
  },
) {}

/**
 * The SKU as it is stored: trimmed, and absent when nothing is left. Blank is
 * no SKU, so any number of offerings can go without one (the member is
 * unique, and an absent value never collides).
 */
export const normalizedSku = (raw: string | undefined): string | undefined => {
  const sku = raw?.trim();
  return sku === undefined || sku === '' ? undefined : sku;
};

/** Whether a normalized SKU may be stored. */
export const isSku = (sku: string): boolean =>
  sku.length <= SKU_MAX_LENGTH && SKU_PATTERN.test(sku);
