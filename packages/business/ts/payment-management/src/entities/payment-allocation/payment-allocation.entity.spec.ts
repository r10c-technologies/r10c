import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PaymentAllocation } from './payment-allocation.entity.js';

describe('PaymentAllocation', () => {
  it('starts empty, as a card share with nothing taken', () => {
    expect(new PaymentAllocation()).toMatchObject({
      paymentId: '',
      groupId: '',
      orderId: '',
      vendorId: '',
      authorized: 0,
      captured: 0,
      refunded: 0,
      currency: '',
      paymentMethod: 'card',
    });
  });

  it('round-trips every member through serialization', async () => {
    const share = Object.assign(new PaymentAllocation(), {
      id: 'alloc-1',
      paymentId: 'pay-1',
      groupId: 'group-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      authorized: 30,
      captured: 30,
      refunded: 10,
      currency: 'GTQ',
      paymentMethod: 'cod',
    });

    const revived = await Effect.runPromise(
      deserializeSingleEntity(PaymentAllocation, {
        ...serializeEntity(PaymentAllocation, share),
        id: 'alloc-1',
      }),
    );

    expect(revived).toMatchObject({
      id: 'alloc-1',
      paymentId: 'pay-1',
      groupId: 'group-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      authorized: 30,
      captured: 30,
      refunded: 10,
      currency: 'GTQ',
      paymentMethod: 'cod',
    });
  });

  it('lets an operator filter by order and vendor, never by an amount', () => {
    const columns = describeEntityColumns(PaymentAllocation);
    const named = (name: string) =>
      columns.find(column => column.name === name);

    expect(named('orderId')?.filterable).toBe(true);
    expect(named('vendorId')?.filterable).toBe(true);
    expect(named('refunded')?.filterable).toBe(false);
  });
});
