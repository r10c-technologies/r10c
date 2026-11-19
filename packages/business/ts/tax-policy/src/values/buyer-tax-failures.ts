import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The three ways a buyer's fiscal identity is refused — at the review form and
 * again by the coordinator, under the same codes, so a buyer never meets a
 * refusal the form did not already name. Declared as failures so the codes
 * are registered and the `errors` catalog is checked against them.
 */
export class BuyerTaxIdTypeUnknown extends Failure.invalid<BuyerTaxIdTypeUnknown>()(
  'BuyerTaxIdTypeUnknown',
  'invalidTaxIdType',
  {},
  { message: () => 'a buyer is documented by NIT, CUI or as consumidor final' },
) {}

export class BuyerTaxIdInvalid extends Failure.invalid<BuyerTaxIdInvalid>()(
  'BuyerTaxIdInvalid',
  'invalidTaxId',
  { idType: Schema.Literals(['nit', 'cui']) },
  {
    message: ({ idType }) =>
      `the buyer’s ${idType.toUpperCase()} does not validate`,
  },
) {}

export class BuyerTaxNameRequired extends Failure.invalid<BuyerTaxNameRequired>()(
  'BuyerTaxNameRequired',
  'missingName',
  {},
  { message: () => 'an identified buyer names whom the document is issued to' },
) {}
