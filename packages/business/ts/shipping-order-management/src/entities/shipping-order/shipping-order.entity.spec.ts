import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShipmentDestination } from '../../values/shipment-destination.js';
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
      orderNumber: '7KQ4-M2XD',
      groupId: 'grp-1',
      flowId: 'flow-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [new ShippingLine('o-1', 2)],
      destination: [
        Object.assign(new ShipmentDestination(), {
          name: 'Ana',
          phone: '+50255551234',
          departamento: '01',
          municipio: '0101',
          addressLine: '5a avenida',
        }),
      ],
      status: 'returned',
      dispatchedAt: AT,
      deliveredAt: AT,
      refusedAt: AT,
      returnedAt: AT,
      redactedAt: AT,
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
      orderNumber: '7KQ4-M2XD',
      lines: [{ offeringId: 'o-1', quantity: 2 }],
      destination: [
        {
          name: 'Ana',
          phone: '+50255551234',
          departamento: '01',
          municipio: '0101',
          addressLine: '5a avenida',
        },
      ],
      status: 'returned',
      dispatchedAt: AT,
      deliveredAt: AT,
      refusedAt: AT,
      returnedAt: AT,
      redactedAt: AT,
    });
  });

  it('keeps the flow id unqueryable, because it is a correlation rather than a fact', () => {
    const columns = describeEntityColumns(ShippingOrder);
    const flowId = columns.find(column => column.name === 'flowId');

    expect(flowId).toMatchObject({ filterable: false, sortable: false });
  });

  it('reads its amounts as money in minor units of its own currency', () => {
    // Every amount in the fleet is stored in minor units. Without `money`, a
    // generated table prints 5499 where a person reads Q54.99.
    const columns = describeEntityColumns(ShippingOrder);
    for (const name of ['amountDue']) {
      expect(columns.find(column => column.name === name)?.money).toEqual({
        unit: 'minor',
        currencyMember: 'currency',
      });
    }
  });
});
