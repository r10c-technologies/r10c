import { describe, expect, it } from 'vitest';

import { buyerTaxOfStart, taxedPart } from './checkout-tax.js';

const RULES = {
  general: { rateBasisPoints: 1200, basis: 'inclusive' },
  'small-taxpayer': { rateBasisPoints: 500, basis: 'gross' },
  simplified: { rateBasisPoints: 1200, basis: 'inclusive' },
} as const;

const SELLER = {
  taxId: '10000003',
  legalName: 'Demo, S.A.',
  taxRegime: 'general',
  establishmentCode: '1',
};

const PART = {
  vendorId: 'v-1',
  // A line as the coordinator priced it: its total stated (ADR 0082 §6).
  lines: [
    {
      offeringId: 'o-1',
      amount: 560,
      quantity: 2,
      lineTotal: 1120,
      currency: 'GTQ',
    },
  ],
};

describe('taxedPart', () => {
  it('states the seller and each line’s tax, overwriting what was sent', () => {
    expect(
      taxedPart({ ...PART, sellerTax: { taxId: 'forged' } }, SELLER, RULES),
    ).toEqual({
      ...PART,
      sellerTax: SELLER,
      netAmount: 1000,
      taxAmount: 120,
      totalAmount: 1120,
      lines: [
        {
          ...PART.lines[0],
          kind: 'good',
          taxTreatment: 'taxed',
          taxRate: 1200,
          taxableBase: 1000,
          taxAmount: 120,
        },
      ],
    });
  });

  it('states nothing for a seller it holds no fiscal identity for', () => {
    const forged = { ...PART, sellerTax: { taxId: 'forged' } };
    expect(taxedPart(forged, undefined, RULES)).toEqual(PART);
    expect(taxedPart(forged, { ...SELLER, legalName: ' ' }, RULES)).toEqual(
      PART,
    );
    expect(taxedPart(forged, { ...SELLER, taxRegime: 'x' }, RULES)).toEqual(
      PART,
    );
  });

  it('reads a part with no lines as an empty document', () => {
    expect(taxedPart({ vendorId: 'v-1' }, SELLER, RULES)).toMatchObject({
      totalAmount: 0,
      lines: [],
    });
    // A line that is not whole minor units is left for the start's decoding.
    expect(
      taxedPart({ vendorId: 'v-1', lines: [null] }, SELLER, RULES),
    ).toEqual({ vendorId: 'v-1', lines: [null] });
  });
});

describe('buyerTaxOfStart', () => {
  it('documents a buyer who gave nothing as consumidor final, by the contact', () => {
    expect(buyerTaxOfStart({ contact: { name: 'Ana' } })).toEqual({
      ok: true,
      value: { idType: 'cf', taxId: 'CF', name: 'Ana' },
    });
    expect(buyerTaxOfStart({})).toMatchObject({
      ok: true,
      value: { name: '' },
    });
  });

  it('refuses a NIT that does not validate, under its code', () => {
    const refused = buyerTaxOfStart({
      buyerTax: { idType: 'nit', taxId: '1', name: 'A' },
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.refusal.errors[0]?.code).toBe(
      'invalidTaxId',
    );
  });
});
