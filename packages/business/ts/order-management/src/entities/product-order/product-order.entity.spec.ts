import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrderItem } from '../../values/order-item.js';
import { ProductOrder } from './product-order.entity.js';

const line = (vendorId: string, amount: number): OrderItem =>
  new OrderItem(
    `off-${vendorId}`,
    vendorId,
    1,
    amount,
    'EUR',
    `res-${vendorId}`,
  );

/** The plain document one {@link line} becomes on the wire and in storage. */
const lineData = (vendorId: string, amount: number) => ({
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
      items: [lineData('vendor-a', 1000), lineData('vendor-b', 250)],
      placedAt,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const order = await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, {
        id: 'order-2',
        buyerId: 'buyer-2',
        status: 'paid',
        items: [lineData('vendor-a', 500)],
        placedAt: new Date('2026-08-12T10:00:00.000Z'),
      }),
    );

    expect(order?.status).toBe('paid');
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0]?.vendorId).toBe('vendor-a');
  });

  it('opens pending with no lines, so an empty order promises nothing', () => {
    const order = new ProductOrder();

    expect(order.buyerId).toBeUndefined();
    expect(order.status).toBe('pending');
    expect(order.items).toEqual([]);
    expect(order.placedAt).toBeUndefined();
    expect(order.channel).toBeUndefined();
  });

  it('captures a counter sale with no buyer at all', () => {
    // A walk-in has no account, and demanding one at the register is friction
    // that gets worked around by inventing junk parties. The channel is what
    // explains the absence (ADR 0024).
    const order = new ProductOrder();
    order.channel = { id: 'sc-1', name: 'Tienda Centro', type: 'counter' };
    order.items = [line('vendor-a', 1000)];

    expect(serializeEntity(ProductOrder, order)).toEqual({
      status: 'pending',
      items: [lineData('vendor-a', 1000)],
      channel: { id: 'sc-1', name: 'Tienda Centro', type: 'counter' },
    });
  });

  it('copies the channel name onto the order rather than pointing at it', () => {
    // A SalesChannel lives in another slice's tenant store, and this order is
    // platform plane — a platform-plane reader cannot dereference a tenant
    // pointer. Same reason PublishedOffering copies price and vendor.
    const order = new ProductOrder('buyer-9');
    order.channel = { id: 'sc-2', name: 'Mostrador 2', type: 'counter' };

    expect(order.channel.name).toBe('Mostrador 2');
  });

  it('keeps the channel out of the query allowlist, like the lines', () => {
    const channel = describeEntityColumns(ProductOrder).find(
      column => column.name === 'channel',
    );

    expect(channel?.filterable).toBe(false);
    expect(channel?.sortable).toBe(false);
  });

  it('accepts the setters a repository writes back through', () => {
    const order = new ProductOrder();
    order.buyerId = 'buyer-3';
    order.status = 'cancelled';
    order.items = [];
    order.placedAt = undefined;
    order.paidAt = undefined;
    order.channel = undefined;

    expect(order.buyerId).toBe('buyer-3');
    expect(order.status).toBe('cancelled');
    expect(order.items).toEqual([]);
    expect(order.placedAt).toBeUndefined();
    expect(order.paidAt).toBeUndefined();
    expect(order.channel).toBeUndefined();
  });

  it('carries the capture time the payment projection stamps', async () => {
    // The projection writes `paidAt` beside `status` in one conditional update.
    // It did that for a release while this accessor did not exist, which put the
    // value in Mongo and nowhere a reader could reach — a member with no getter
    // is invisible to every adapter (#249).
    const paidAt = new Date('2026-09-08T12:00:00.000Z');
    const order = await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, {
        id: 'order-5',
        buyerId: 'buyer-5',
        status: 'paid',
        items: [lineData('vendor-a', 500)],
        placedAt: new Date('2026-09-08T11:00:00.000Z'),
        paidAt,
      }),
    );

    expect(order?.paidAt).toEqual(paidAt);
    expect(serializeEntity(ProductOrder, order!)).toMatchObject({ paidAt });
  });

  it('answers queries about when money arrived', () => {
    // Both flags on purpose: "what did we take money for this week" is the
    // question a vendor's statement is reconciled against, and member metadata
    // is the server-side query allowlist.
    const paidAt = describeEntityColumns(ProductOrder).find(
      column => column.name === 'paidAt',
    );

    expect(paidAt?.type).toBe('date');
    expect(paidAt?.sortable).toBe(true);
    expect(paidAt?.filterable).toBe(true);
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
    // A `composition`: owned rows, one write, no life outside this order
    // (ADR 0034). Never queryable — member metadata is also the server-side
    // allowlist and an array compared as a scalar matches nothing — and
    // `hidden` would be wrong for the opposite reason: it drops a member from
    // deserialization too, so the lines would never persist.
    const items = describeEntityColumns(ProductOrder).find(
      column => column.name === 'items',
    );

    expect(items?.type).toBe('composition');
    expect(items?.childType).toBe(OrderItem);
    expect(items?.filterable).toBe(false);
    expect(items?.sortable).toBe(false);
  });

  /**
   * The line a `composition` draws that nothing else does: a child's state
   * lives in its private fields, so an array passed through untouched reaches
   * Mongo as `[{}, {}]` and the order comes back with lines that hold nothing.
   * Serializing each row through the child's own accessors is what makes "one
   * write, master and rows together" actually store anything.
   */
  it('flattens each line through the child’s own accessors', async () => {
    const order = new ProductOrder('buyer-6');
    order.items = [line('vendor-a', 1000)];

    const document = serializeEntity(ProductOrder, order);

    expect(document['items']).toEqual([lineData('vendor-a', 1000)]);

    const rebuilt = await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, document),
    );

    expect(rebuilt?.items[0]?.amount).toBe(1000);
    expect(rebuilt?.items[0]?.currency).toBe('EUR');
  });
});

/**
 * The buyer's cancel capability, as the order carries it.
 *
 * ⚠️ **The digest, never the nonce.** An order is written inside the checkout
 * saga, so everything on it becomes a step outcome the `saga` store keeps and
 * `GET /api/saga/:id` serves to every vendor in the basket. A bearer token there
 * would let one of them cancel a multi-vendor order their own session is refused
 * with `409`; a digest is inert (ADR 0058).
 */
describe('the cancel capability on an order', () => {
  it('serializes the digest and the window it opens', () => {
    const order = new ProductOrder('party-1');
    const cancelWindowEndsAt = new Date('2026-09-11T12:30:00.000Z');
    order.cancelDigest = 'a'.repeat(64);
    order.cancelWindowEndsAt = cancelWindowEndsAt;

    expect(serializeEntity(ProductOrder, order)).toMatchObject({
      cancelDigest: 'a'.repeat(64),
      cancelWindowEndsAt,
    });
  });

  /**
   * ⚠️ **Not `hidden`, however much a machine-valued member wants to be.** That
   * flag drops a member from deserialization as well as serialization, so a
   * hidden digest would never arrive off the wire and the member would sit
   * permanently empty — the same trap `readonly` is.
   */
  it('rebuilds the capability from a stored record', async () => {
    const order = await Effect.runPromise(
      deserializeSingleEntity(ProductOrder, {
        id: 'order-1',
        status: 'paid',
        items: [],
        cancelDigest: 'b'.repeat(64),
        cancelWindowEndsAt: '2026-09-11T12:30:00.000Z',
      }),
    );

    expect(order?.cancelDigest).toBe('b'.repeat(64));
    expect(order?.cancelWindowEndsAt).toBeDefined();
  });

  /**
   * ⚠️ Member metadata is the server-side query allowlist, so a filterable
   * digest would let a caller confirm a guess one request at a time and a
   * sortable one would leak the order they were minted in.
   *
   * ⚠️ **Asserted rather than assumed, because the defaults run the other way.**
   * `describeEntityColumns` turns both on for any scalar that does not say
   * otherwise, so this is the test that catches the flags being dropped in a
   * later edit — omission is not denial.
   */
  it('makes the digest unqueryable and the window queryable', () => {
    const columns = describeEntityColumns(ProductOrder);
    const digest = columns.find(column => column.name === 'cancelDigest');
    const window = columns.find(column => column.name === 'cancelWindowEndsAt');

    expect(digest?.filterable).toBe(false);
    expect(digest?.sortable).toBe(false);
    expect(window?.filterable).toBe(true);
  });

  /** A counter sale carries neither: at a till there is no browser to hold one. */
  it('carries neither by default', () => {
    const order = new ProductOrder();

    expect(order.cancelDigest).toBeUndefined();
    expect(order.cancelWindowEndsAt).toBeUndefined();
  });
});
