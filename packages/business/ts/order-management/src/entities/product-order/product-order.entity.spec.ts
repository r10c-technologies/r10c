import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { OrderItem } from '../../values/order-item.js';
import { ProductOrder } from './product-order.entity.js';

const line = (vendorId: string, amount: number): OrderItem => ({
  offeringId: `off-${vendorId}`,
  vendorId,
  quantity: 1,
  amount,
  currency: 'EUR',
  reservationId: `res-${vendorId}`,
});

describe('ProductOrder', () => {
  it('serializes one order carrying lines from several vendors', () => {
    const placedAt = new Date('2026-08-12T09:00:00.000Z');
    const order = new ProductOrder('buyer-1');
    order.id = 'order-1';
    order.items = [line('vendor-a', 1000), line('vendor-b', 250)];
    order.placedAt = placedAt;

    expect(serializeEntity(ProductOrder, order)).toEqual({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: 'pending',
      items: [line('vendor-a', 1000), line('vendor-b', 250)],
      placedAt,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const order = await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, {
        id: 'order-2',
        buyerId: 'buyer-2',
        status: 'paid',
        items: [line('vendor-a', 500)],
        placedAt: new Date('2026-08-12T10:00:00.000Z'),
      }),
    );

    expect(order?.status).toBe('paid');
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0]?.vendorId).toBe('vendor-a');
  });

  it('opens pending with no lines, so an empty order promises nothing', () => {
    const order = new ProductOrder();

    expect(order.buyerId).toBe('');
    expect(order.status).toBe('pending');
    expect(order.items).toEqual([]);
    expect(order.placedAt).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const order = new ProductOrder();
    order.buyerId = 'buyer-3';
    order.status = 'cancelled';
    order.items = [];
    order.placedAt = undefined;

    expect(order.buyerId).toBe('buyer-3');
    expect(order.status).toBe('cancelled');
    expect(order.items).toEqual([]);
    expect(order.placedAt).toBeUndefined();
  });

  it('keeps a multi-vendor basket as one order, tagged per line', () => {
    // One receipt for the buyer; settlement aggregates by the line's vendorId.
    // The alternative — one order per vendor — makes settlement trivial and
    // shows the buyer N orders for one payment.
    const order = new ProductOrder('buyer-4');
    order.items = [line('vendor-a', 1000), line('vendor-b', 250)];

    expect(new Set(order.items.map(item => item.vendorId))).toEqual(
      new Set(['vendor-a', 'vendor-b']),
    );
  });

  it('holds a reservation id per line, never a quantity to reverse', () => {
    // Compensation releases the hold; it never re-does arithmetic
    // order-management did not perform.
    const order = new ProductOrder('buyer-5');
    order.items = [line('vendor-a', 1000)];

    expect(order.items[0]?.reservationId).toBe('res-vendor-a');
  });

  it('keeps the embedded lines on the wire but out of the query allowlist', () => {
    // An object array is outside the `MetaAccessorTypes` taxonomy, so it is
    // declared as its element type with sorting and filtering off — member
    // metadata is also the server-side allowlist, and an array compared as a
    // scalar matches nothing. `hidden` would be wrong: it drops a member from
    // deserialization too, so the lines would never persist.
    const items = describeEntityColumns(ProductOrder).find(
      column => column.name === 'items',
    );

    expect(items?.filterable).toBe(false);
    expect(items?.sortable).toBe(false);
  });
});
