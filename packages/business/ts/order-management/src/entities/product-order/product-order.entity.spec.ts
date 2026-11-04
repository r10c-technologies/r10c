import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrderItem } from '../../values/order-item.js';
import { ProductOrder } from './product-order.entity.js';

const PLACED = new Date('2026-08-12T09:00:00.000Z');
const PAID = new Date('2026-08-12T09:05:00.000Z');

const lineData = (amount: number) => ({
  offeringId: 'off-1',
  quantity: 1,
  amount,
  currency: 'EUR',
  reservationId: 'res-1',
});

const anOrder = () =>
  Object.assign(new ProductOrder('buyer-1'), {
    id: 'order-1',
    vendorId: 'vendor-a',
    groupId: 'group-1',
    paymentMethod: 'cod',
    channel: { id: 'ch-1', type: 'counter' },
    items: [new OrderItem('off-1', 1, 1000, 'EUR', 'res-1')],
    placedAt: PLACED,
    paidAt: PAID,
  });

describe('ProductOrder', () => {
  it('serializes one vendor’s order: its vendor, its group, its tender and its lines', () => {
    expect(serializeEntity(ProductOrder, anOrder())).toEqual({
      id: 'order-1',
      buyerId: 'buyer-1',
      vendorId: 'vendor-a',
      groupId: 'group-1',
      paymentMethod: 'cod',
      channel: { id: 'ch-1', type: 'counter' },
      status: 'pending',
      items: [lineData(1000)],
      placedAt: PLACED,
      paidAt: PAID,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const order = (await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, {
        ...serializeEntity(ProductOrder, anOrder()),
        id: 'order-1',
        status: 'dispatched',
      }),
    )) as ProductOrder;

    expect(order).toMatchObject({
      id: 'order-1',
      buyerId: 'buyer-1',
      vendorId: 'vendor-a',
      groupId: 'group-1',
      paymentMethod: 'cod',
      status: 'dispatched',
      items: [lineData(1000)],
    });
    expect(order.channel).toEqual({ id: 'ch-1', type: 'counter' });
    expect(order.paidAt).toEqual(PAID);
  });

  it('opens pending, paid by card, owing nobody, with no buyer for a counter sale', () => {
    const order = new ProductOrder();

    expect(order).toMatchObject({
      vendorId: '',
      groupId: '',
      paymentMethod: 'card',
      status: 'pending',
      items: [],
    });
    expect(order.buyerId).toBeUndefined();
  });

  it('lets a vendor’s list filter and sort on its own vendor, and keeps the lines and channel out of the allowlist', () => {
    const columns = describeEntityColumns(ProductOrder);
    const named = (name: string) =>
      columns.find(column => column.name === name);

    expect(named('vendorId')).toMatchObject({
      filterable: true,
      sortable: true,
    });
    expect(named('groupId')?.filterable).toBe(true);
    expect(named('items')).toMatchObject({
      filterable: false,
      sortable: false,
    });
    expect(named('channel')).toMatchObject({
      filterable: false,
      sortable: false,
    });
  });

  it('accepts the setters a repository writes back through', () => {
    const order = new ProductOrder();
    order.buyerId = 'buyer-9';

    expect(order.buyerId).toBe('buyer-9');
  });
});
