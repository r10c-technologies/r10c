import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrderEventSchema } from './order-event.js';
import { orderEventDataOf } from './order-event-data.js';

const STORED = {
  _id: 'mongo-internal',
  id: 'order-1',
  number: 'ABCD-EFGH',
  buyerId: 'party-1',
  vendorId: 'v-1',
  groupId: 'g-1',
  paymentMethod: 'card',
  status: 'paid',
  placedAt: '2026-11-18T10:00:00.000Z',
  sellerTaxId: '10000003',
  sellerLegalName: 'Demo, S.A.',
  sellerTaxRegime: 'general',
  sellerEstablishmentCode: '1',
  buyerTaxIdType: 'nit',
  buyerTaxId: '12345679',
  buyerTaxName: 'Ana López',
  netAmount: 1000,
  taxAmount: 120,
  totalAmount: 1120,
  currency: 'GTQ',
  items: [
    {
      offeringId: 'o-1',
      name: 'Lámpara',
      description: 'De bronce.',
      specificationId: 'spec-1',
      specificationVersion: 2,
      saleUnit: 'UN',
      quantity: 1,
      amount: 1120,
      pricePer: 1,
      lineTotal: 1120,
      currency: 'GTQ',
      reservationId: 'res-1',
      kind: 'good',
      taxTreatment: 'taxed',
      taxRate: 1200,
      taxableBase: 1000,
      taxAmount: 120,
    },
  ],
};

describe('orderEventDataOf', () => {
  it('builds a payload the registered contract accepts as a whole fact', () => {
    expect(Schema.is(OrderEventSchema)(orderEventDataOf(STORED))).toBe(true);
  });

  it('names the sale, the seller’s identity and each line’s tax', () => {
    expect(orderEventDataOf(STORED)).toEqual({
      id: 'order-1',
      number: 'ABCD-EFGH',
      buyerId: 'party-1',
      vendorId: 'v-1',
      groupId: 'g-1',
      paymentMethod: 'card',
      status: 'paid',
      placedAt: '2026-11-18T10:00:00.000Z',
      netAmount: 1000,
      taxAmount: 120,
      totalAmount: 1120,
      currency: 'GTQ',
      sellerTax: {
        taxId: '10000003',
        legalName: 'Demo, S.A.',
        taxRegime: 'general',
        establishmentCode: '1',
      },
      items: [
        {
          offeringId: 'o-1',
          name: 'Lámpara',
          description: 'De bronce.',
          specificationId: 'spec-1',
          specificationVersion: 2,
          saleUnit: 'UN',
          quantity: 1,
          amount: 1120,
          pricePer: 1,
          lineTotal: 1120,
          currency: 'GTQ',
          kind: 'good',
          taxTreatment: 'taxed',
          taxRate: 1200,
          taxableBase: 1000,
          taxAmount: 120,
        },
      ],
    });
  });

  it('never carries the buyer’s fiscal identity, nor anything unnamed', () => {
    const data = JSON.stringify(orderEventDataOf(STORED));
    expect(data).not.toContain('12345679');
    expect(data).not.toContain('buyerTax');
    expect(data).not.toContain('mongo-internal');
    expect(data).not.toContain('res-1');
  });

  it('carries no lines for a record that holds none', () => {
    expect(orderEventDataOf({ id: 'order-2' }).items).toEqual([]);
  });
});
