import { fragmentRef } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import {
  ORDER_FRAGMENTS,
  orderClaimCancel,
  orderMarkDispatched,
  orderMarkShipped,
  orderOpenGroup,
  orderPaymentDecision,
  orderWrite,
} from './order-fragments.js';

describe('order fragments', () => {
  it('are pinned and owned by order-management', () => {
    expect(ORDER_FRAGMENTS.map(fragmentRef)).toEqual([
      'order.open-group@3',
      'order.write@7',
      'order.claim-cancel@3',
      'order.confirm@2',
      'order.await-payment@1',
      'order.payment-decision@2',
      'order.mark-dispatched@2',
      'order.mark-shipped@1',
      'order.close@2',
      'order.notify-buyer@1',
    ]);
    expect(new Set(ORDER_FRAGMENTS.map(f => f.module))).toEqual(
      new Set(['order-management']),
    );
  });

  it('open the group first, write one order per vendor into it, and lock an order they cancel', () => {
    expect(Object.keys(orderOpenGroup.provides ?? {})).toEqual(['groupId']);
    expect(orderWrite.cardinality).toBe('perVendor');
    expect(Object.keys(orderWrite.consumes ?? {})).toEqual(['groupId']);
    expect(Object.keys(orderWrite.provides ?? {})).toEqual([
      'orderId',
      'orderNumber',
    ]);
    expect(orderClaimCancel.isolation).toBe('semanticLock');
  });

  it('wait on a seller’s decision and provide the authorization number it was answered with', () => {
    expect(Object.keys(orderPaymentDecision.provides ?? {})).toEqual([
      'paymentReference',
    ]);
  });

  it('tell a shipped order the guide its dispatch answered', () => {
    expect(Object.keys(orderMarkShipped.consumes ?? {})).toEqual([
      'orderId',
      'courierName',
      'trackingNumber',
      'trackingUrl',
    ]);
    expect(orderMarkShipped.call).toEqual(orderMarkDispatched.call);
  });

  it('wait for the seller’s decision on a payment link, answered either way', () => {
    expect(orderPaymentDecision.kind).toBe('wait');
    expect(orderPaymentDecision.outcomes).toEqual(['confirmed', 'cancelled']);
  });

  it('roll every move after the commit point forward rather than back', () => {
    expect(
      ORDER_FRAGMENTS.filter(f => f.kind === 'retriable').map(f => f.id),
    ).toEqual([
      'order.confirm',
      'order.await-payment',
      'order.mark-dispatched',
      'order.mark-shipped',
      'order.close',
      'order.notify-buyer',
    ]);
  });
});
