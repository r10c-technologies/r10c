import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingLine } from '../../values/shipping-line.js';
import { ShippingOrder } from './shipping-order.entity.js';

const AT = new Date('2026-11-03T10:00:00.000Z');

describe('ShippingOrder', () => {
  it('opens awaiting dispatch, paid by card, with nothing due', () => {
    const order = new ShippingOrder();

    expect(order).toMatchObject({
      status: 'awaiting-dispatch',
      paymentMethod: 'card',
      amountDue: 0,
      orderId: '',
      groupId: '',
      currency: '',
      lines: [],
    });
  });

  it('round-trips every member through serialization, the stamps included', async () => {
    const order = Object.assign(new ShippingOrder(), {
      id: 's-1',
      orderId: 'ord-1',
      groupId: 'grp-1',
      flowId: 'flow-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [new ShippingLine('o-1', 2)],
      status: 'returned',
      dispatchedAt: AT,
      deliveredAt: AT,
      refusedAt: AT,
      returnedAt: AT,
    });

    const revived = await Effect.runPromise(
      deserializeSingleEntity(ShippingOrder, {
        ...serializeEntity(ShippingOrder, order),
        id: 's-1',
      }),
    );

    expect(revived).toMatchObject({
      id: 's-1',
      orderId: 'ord-1',
      groupId: 'grp-1',
      flowId: 'flow-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [{ offeringId: 'o-1', quantity: 2 }],
      status: 'returned',
      dispatchedAt: AT,
      deliveredAt: AT,
      refusedAt: AT,
      returnedAt: AT,
    });
  });

  it('keeps the flow id unqueryable, because it is a correlation rather than a fact', () => {
    const columns = describeEntityColumns(ShippingOrder);
    const flowId = columns.find(column => column.name === 'flowId');

    expect(flowId).toMatchObject({ filterable: false, sortable: false });
  });
});
