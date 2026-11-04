import { fragmentRef } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import {
  FULFILMENT_FRAGMENTS,
  fulfilmentDispatch,
} from './fulfilment-fragments.js';

describe('FULFILMENT_FRAGMENTS', () => {
  it('declares the seven steps a delivery or a cancellation takes', () => {
    expect(FULFILMENT_FRAGMENTS.map(fragmentRef)).toEqual([
      'fulfilment.open@1',
      'fulfilment.hold@1',
      'fulfilment.release@1',
      'fulfilment.withdraw@1',
      'fulfilment.dispatch@1',
      'fulfilment.await-delivery@1',
      'fulfilment.await-return@1',
    ]);
  });

  it('makes dispatch the irreversible pivot, under the lock a hold takes', () => {
    expect(fulfilmentDispatch).toMatchObject({
      kind: 'pivot',
      irreversible: true,
      isolation: 'semanticLock',
    });
  });

  it('gates every step on the shipping entitlement, and calls fulfilment-service', () => {
    for (const fragment of FULFILMENT_FRAGMENTS) {
      expect(fragment.requires?.entitlements).toEqual([
        'shipping-order-management',
      ]);
      expect(fragment.participant).toBe('fulfilment-service');
    }
  });
});
