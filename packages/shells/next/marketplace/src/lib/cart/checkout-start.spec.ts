import { describe, expect, it } from 'vitest';

import {
  acceptedFlowId,
  checkoutStartBody,
  sellerParts,
  tenderField,
  tenderOf,
} from './checkout-start.js';

const line = (offeringId: string, vendorId: string, amount = 100) => ({
  offeringId,
  vendorId,
  quantity: 2,
  amount,
  currency: 'GTQ',
});

describe('sellerParts', () => {
  it('splits a basket per seller, in the order each first appears, with each one’s tender', () => {
    const parts = sellerParts(
      [line('a', 'v-2'), line('b', 'v-1'), line('c', 'v-2')],
      vendorId => (vendorId === 'v-1' ? 'cod' : 'card'),
    );

    expect(parts.map(part => [part.vendorId, part.paymentMethod])).toEqual([
      ['v-2', 'card'],
      ['v-1', 'cod'],
    ]);
    expect(parts[0]?.lines.map(entry => entry.offeringId)).toEqual(['a', 'c']);
  });

  it('pays every seller by card unless told otherwise', () => {
    expect(sellerParts([line('a', 'v-1')])[0]?.paymentMethod).toBe('card');
  });
});

describe('tenders', () => {
  it('reads a form field as cash on delivery only when it says so', () => {
    expect([tenderOf('cod'), tenderOf('card'), tenderOf(null)]).toEqual([
      'cod',
      'card',
      'card',
    ]);
    expect(tenderField('v-1')).toBe('method:v-1');
  });
});

describe('checkoutStartBody', () => {
  it('carries the sellers, the basket’s totals and both digests', () => {
    const parts = sellerParts([line('a', 'v-1', 100), line('b', 'v-2', 50)]);

    expect(
      checkoutStartBody({ parts, cancelDigest: 'cd', capabilityDigest: 'fd' }),
    ).toEqual({
      vendors: parts,
      totals: [{ currency: 'GTQ', amount: 300 }],
      cancelDigest: 'cd',
      capabilityDigest: 'fd',
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
