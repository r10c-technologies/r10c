import { fragmentRef } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import {
  ORDER_FRAGMENTS,
  orderClaimCancel,
  orderWrite,
} from './order-fragments';

describe('order fragments', () => {
  it('are pinned at version 1 and owned by order-management', () => {
    expect(ORDER_FRAGMENTS.map(fragmentRef)).toEqual([
      'order.write@1',
      'order.claim-cancel@1',
      'order.close-cancelled@1',
    ]);
    expect(new Set(ORDER_FRAGMENTS.map(f => f.module))).toEqual(
      new Set(['order-management']),
    );
  });

  it('provide the written order to later steps, and lock an order they cancel', () => {
    expect(Object.keys(orderWrite.provides ?? {})).toEqual(['orderId']);
    expect(orderClaimCancel.isolation).toBe('semanticLock');
  });
});
