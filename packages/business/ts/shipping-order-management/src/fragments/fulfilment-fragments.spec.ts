import { fragmentRef } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import {
  FULFILMENT_FRAGMENTS,
  fulfilmentAwaitDelivery,
  fulfilmentAwaitReturn,
  fulfilmentDispatch,
} from './fulfilment-fragments.js';

describe('FULFILMENT_FRAGMENTS', () => {
  it('declares the seven steps a delivery or a cancellation takes', () => {
    expect(FULFILMENT_FRAGMENTS.map(fragmentRef)).toEqual([
      'fulfilment.open@2',
      'fulfilment.hold@2',
      'fulfilment.release@2',
      'fulfilment.withdraw@2',
      'fulfilment.dispatch@2',
      'fulfilment.await-delivery@3',
      'fulfilment.await-return@3',
    ]);
  });

  it('declares what each wait is answered with, for the delivery flow to branch on', () => {
    expect(fulfilmentAwaitDelivery.outcomes).toEqual(['delivered', 'refused']);
    expect(fulfilmentAwaitReturn.outcomes).toEqual(['returned']);
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
