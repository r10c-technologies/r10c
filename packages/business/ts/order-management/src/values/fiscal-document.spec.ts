import { TaxRegimes } from '@r10c/business-ts-tax-policy';
import { describe, expect, it } from 'vitest';

import { fiscalDocumentTypeFor } from './fiscal-document.js';

describe('fiscalDocumentTypeFor', () => {
  it('issues an FPEQ for a pequeño contribuyente and a FACT for every other regime', () => {
    expect(
      Object.fromEntries(
        TaxRegimes.map(regime => [regime, fiscalDocumentTypeFor(regime)]),
      ),
    ).toEqual({
      general: 'FACT',
      'small-taxpayer': 'FPEQ',
      simplified: 'FACT',
    });
  });
});
