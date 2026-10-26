import { deserializeSingleEntity, serializeEntity } from '@entifix/core';
import { Effect } from 'effect';

import { ProductOrder } from '../entities/product-order';
import type { ProductOrderStore } from '../ports/product-order-store';
import type { OrderItem } from '../values/order-item';

/**
 * A {@link ProductOrderStore} held in memory, for the specs of whatever
 * consumes the port. It runs `describeProductOrderStoreContract`, so every
 * step is conditional on the one before, the way the Mongo store's writes are.
 */
export const makeInMemoryProductOrderStore = (): ProductOrderStore => {
  const orders = new Map<string, ProductOrder>();
  const commands = new Map<string, ProductOrder | 'claimed'>();
  const events = new Set<string>();

  /** A stored copy, through the same serialization a real store applies. */
  const copy = (order: ProductOrder) =>
    Effect.runSync(
      deserializeSingleEntity(ProductOrder, {
        ...serializeEntity(ProductOrder, order),
        id: order.id,
      }),
    ) as ProductOrder;

  const move = (orderId: string, from: string, to: string) => {
    const order = orders.get(orderId);
    if (order?.status !== from) return undefined;
    order.status = to as ProductOrder['status'];
    return copy(order);
  };

  /** Runs `step` once per command, the way a unit's command claim does. */
  const once = <A>(
    commandId: string | undefined,
    step: () => A | undefined,
  ): A | 'replayed' | undefined => {
    if (commandId !== undefined && commands.has(commandId)) return 'replayed';
    const done = step();
    if (done !== undefined && commandId !== undefined) {
      commands.set(commandId, 'claimed');
    }
    return done;
  };

  return {
    get: orderId =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        return order === undefined ? undefined : copy(order);
      }),
    place: (order, commandId) =>
      Effect.sync(() => {
        const first =
          commandId === undefined ? undefined : commands.get(commandId);
        if (first instanceof ProductOrder) {
          return { _tag: 'replayed', order: first };
        }
        orders.set(String(order.id), copy(order));
        if (commandId !== undefined) commands.set(commandId, copy(order));
        return { _tag: 'placed', order };
      }),
    remove: orderId => Effect.sync(() => orders.delete(orderId)),
    fulfil: (orderId, items, status) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order?.status !== 'paid') return undefined;
        order.items = items as OrderItem[];
        order.status = status as ProductOrder['status'];
        return copy(order);
      }),
    claimCancellation: (orderId, commandId) =>
      Effect.sync(() => {
        const claimed = once(commandId, () =>
          move(orderId, 'paid', 'cancelling'),
        );
        if (claimed === 'replayed') return { _tag: 'replayed' };
        return claimed === undefined
          ? { _tag: 'notClaimable' }
          : { _tag: 'claimed', order: claimed };
      }),
    releaseCancellation: orderId =>
      Effect.sync(() => move(orderId, 'cancelling', 'paid') !== undefined),
    settleCancellation: (orderId, commandId) =>
      Effect.sync(() => {
        const settled = once(commandId, () =>
          move(orderId, 'cancelling', 'cancelled'),
        );
        return settled === 'replayed' ? undefined : settled;
      }),
    markPaid: ({ consumer, eventId }, orderId, paidAt) =>
      Effect.sync(() => {
        const key = `${consumer}:${eventId}`;
        if (events.has(key)) return 'duplicate';
        events.add(key);
        const order = orders.get(orderId);
        if (order?.status === 'pending') {
          order.status = 'paid';
          order.paidAt = new Date(paidAt);
        }
        return 'claimed';
      }),
  };
};
