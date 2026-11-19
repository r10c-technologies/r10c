import { describe, expect, it } from 'vitest';

import { fiscalIdentityOf } from './fiscal-identity.js';

const VALID = {
  taxId: '1234567-9',
  legalName: ' Ferretería Demo, S.A. ',
  taxRegime: 'general',
  establishmentCode: '1',
};

describe('fiscalIdentityOf', () => {
  it('normalizes a valid identity', () => {
    expect(fiscalIdentityOf(VALID)).toEqual({
      ok: true,
      value: {
        taxId: '12345679',
        legalName: 'Ferretería Demo, S.A.',
        taxRegime: 'general',
        establishmentCode: '1',
      },
    });
  });

  it.each([
    ['taxId', { taxId: '1234567-4' }],
    ['legalName', { legalName: '  ' }],
    ['legalName', { legalName: 'x'.repeat(201) }],
    ['taxRegime', { taxRegime: 'pequeño' }],
    ['establishmentCode', { establishmentCode: 'A1' }],
  ])('names %s when it fails', (field, change) => {
    expect(fiscalIdentityOf({ ...VALID, ...change })).toEqual({
      ok: false,
      field,
    });
  });
});
