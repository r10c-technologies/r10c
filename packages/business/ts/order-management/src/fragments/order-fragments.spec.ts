import { fragmentRef } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import {
  ORDER_FRAGMENTS,
  orderClaimCancel,
  orderOpenGroup,
  orderWrite,
} from './order-fragments.js';

describe('order fragments', () => {
  it('are pinned and owned by order-management', () => {
    expect(ORDER_FRAGMENTS.map(fragmentRef)).toEqual([
      'order.open-group@1',
      'order.write@2',
      'order.claim-cancel@2',
      'order.confirm@1',
      'order.mark-dispatched@1',
      'order.close@1',
    ]);
    expect(new Set(ORDER_FRAGMENTS.map(f => f.module))).toEqual(
      new Set(['order-management']),
    );
  });

  it('open the group first, write one order per vendor into it, and lock an order they cancel', () => {
    expect(Object.keys(orderOpenGroup.provides ?? {})).toEqual(['groupId']);
    expect(orderWrite.cardinality).toBe('perVendor');
    expect(Object.keys(orderWrite.consumes ?? {})).toEqual(['groupId']);
    expect(Object.keys(orderWrite.provides ?? {})).toEqual(['orderId']);
    expect(orderClaimCancel.isolation).toBe('semanticLock');
  });

  it('roll every move after the commit point forward rather than back', () => {
    expect(
      ORDER_FRAGMENTS.filter(f => f.kind === 'retriable').map(f => f.id),
    ).toEqual(['order.confirm', 'order.mark-dispatched', 'order.close']);
  });
});
