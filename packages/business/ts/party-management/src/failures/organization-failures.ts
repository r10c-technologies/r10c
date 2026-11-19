import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A fiscal identity that would put a wrong name on every document issued for
 * this organization: a NIT whose check character does not match, an unknown
 * regime, a blank legal name or an establishment that is not a number.
 * `field` names the member, so a form can mark it.
 */
export class InvalidFiscalIdentity extends Failure.invalid<InvalidFiscalIdentity>()(
  'InvalidFiscalIdentity',
  'invalidFiscalIdentity',
  {
    field: Schema.Literals([
      'taxId',
      'legalName',
      'taxRegime',
      'establishmentCode',
    ]),
  },
  { message: ({ field }) => `the fiscal identity's ${field} is not valid` },
) {}
