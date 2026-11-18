import { Invalid, problemOf } from '@entifix/core';
import { VendorDoesNotShip } from '@r10c/business-ts-flow-contracts';

import {
  acceptedFlowId,
  checkoutStartBody,
  chooseTenders,
  refusedSeller,
  sellerParts,
  tenderField,
  tenderOf,
  tendersOffered,
} from './checkout-start.js';

const line = (offeringId: string, vendorId: string, amount = 100) => ({
  offeringId,
  name: `Name of ${offeringId}`,
  vendorId,
  quantity: 2,
  amount,
  currency: 'GTQ',
});

describe('sellerParts', () => {
  it('splits a basket per seller, in the order each first appears', () => {
    const parts = sellerParts([
      line('a', 'v-2'),
      line('b', 'v-1'),
      line('c', 'v-2'),
    ]);

    expect(parts.map(part => part.vendorId)).toEqual(['v-2', 'v-1']);
    expect(parts[0]?.lines.map(entry => entry.offeringId)).toEqual(['a', 'c']);
  });
});

describe('tenders', () => {
  it('reads a form field as a tender, and nothing as none (ADR 0076 §7)', () => {
    expect([
      tenderOf('cod'),
      tenderOf('card'),
      tenderOf(null),
      tenderOf('cash'),
    ]).toEqual(['cod', 'card', undefined, undefined]);
    expect(tenderField('v-1')).toBe('method:v-1');
  });

  it('offers cash on delivery only where the seller collects it', () => {
    expect(tendersOffered({ acceptsCod: true })).toEqual(['card', 'cod']);
    expect(tendersOffered({ acceptsCod: false })).toEqual(['card']);
    expect(tendersOffered(undefined)).toEqual(['card']);
  });
});

describe('chooseTenders', () => {
  const parts = sellerParts([line('a', 'v-1'), line('b', 'v-2')]);
  const offered = (vendorId: string) =>
    vendorId === 'v-1'
      ? tendersOffered({ acceptsCod: true })
      : ['card' as const];

  it('pays each seller as chosen, and a one-tender seller its one tender', () => {
    const choice = chooseTenders(parts, offered, vendorId =>
      vendorId === 'v-1' ? 'cod' : undefined,
    );

    expect(
      'parts' in choice && choice.parts.map(part => part.paymentMethod),
    ).toEqual(['cod', 'card']);
  });

  it('names a two-tender seller with no choice, or one they do not take', () => {
    expect(chooseTenders(parts, offered, () => null)).toEqual({
      missing: ['v-1'],
    });
    expect(
      chooseTenders(
        parts,
        () => ['card'],
        () => 'cod',
      ),
    ).toMatchObject({
      parts: [{ paymentMethod: 'card' }, { paymentMethod: 'card' }],
    });
    expect(
      chooseTenders(
        parts,
        () => ['card', 'cod'],
        () => 'cheque',
      ),
    ).toEqual({ missing: ['v-1', 'v-2'] });
  });
});

describe('checkoutStartBody', () => {
  it('carries the sellers, the basket’s totals and both digests', () => {
    const parts = sellerParts([
      line('a', 'v-1', 100),
      line('b', 'v-2', 50),
    ]).map(part => ({ ...part, paymentMethod: 'card' as const }));

    expect(
      checkoutStartBody({
        parts,
        cancelDigest: 'cd',
        capabilityDigest: 'fd',
        contact: { name: 'Ana' },
        locale: 'es',
      }),
    ).toEqual({
      channel: { type: 'storefront' },
      vendors: parts,
      totals: [{ currency: 'GTQ', amount: 300 }],
      cancelDigest: 'cd',
      capabilityDigest: 'fd',
      contact: { name: 'Ana' },
      locale: 'es',
    });
  });
});

describe('acceptedFlowId', () => {
  it('reads the flow a 202 accepted, and nothing from any other answer', () => {
    const accepted = {
      meta: { type: 'flowAccepted' },
      data: { flowId: 'f-1', links: [] },
    };

    expect(acceptedFlowId(202, accepted)).toBe('f-1');
    expect(acceptedFlowId(200, accepted)).toBeUndefined();
    expect(acceptedFlowId(202, accepted.data)).toBeUndefined();
    expect(acceptedFlowId(202, null)).toBeUndefined();
    expect(
      acceptedFlowId(202, { meta: accepted.meta, data: { flowId: 7 } }),
    ).toBeUndefined();
  });
});

describe('refusedSeller', () => {
  it('names the seller a vendorDoesNotShip refusal names', () => {
    expect(
      refusedSeller(422, problemOf(new VendorDoesNotShip({ vendorId: 'v-x' }))),
    ).toBe('v-x');
  });

  it('names nobody for any other answer', () => {
    expect(refusedSeller(503, undefined)).toBeUndefined();
    expect(
      refusedSeller(400, problemOf(new Invalid({ errors: [] }))),
    ).toBeUndefined();
    expect(refusedSeller(202, { meta: { type: 'flowAccepted' } })).toBeUndefined();
  });
});
