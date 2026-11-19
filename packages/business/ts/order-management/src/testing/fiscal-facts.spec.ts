import { describe, expect, it } from 'vitest';

import { documentOrderBody, fiscalFactsFor } from './fiscal-facts.js';

describe('the fiscal fixtures', () => {
  it('documents a step body as the coordinator would', () => {
    const body = documentOrderBody({
      vendorId: 'v-1',
      items: [
        { offeringId: 'o-1', amount: 1120, quantity: 1, currency: 'GTQ' },
      ],
    });
    expect(body).toMatchObject({
      sellerTaxId: '10000003',
      buyerTaxId: 'CF',
      netAmount: 1000,
      taxAmount: 120,
      totalAmount: 1120,
      currency: 'GTQ',
      items: [{ offeringId: 'o-1', taxableBase: 1000, taxAmount: 120 }],
    });
  });

  it('documents a body with no lines, in quetzales', () => {
    expect(documentOrderBody({ vendorId: 'v-1' })).toMatchObject({
      items: [],
      totalAmount: 0,
    });
    expect(fiscalFactsFor([]).order.currency).toBe('GTQ');
  });
});
