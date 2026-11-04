import {
  deserializeSingleEntity,
  NotFound,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';

import { ShippingOrder } from '../entities/shipping-order';
import { ShippingOrderNotTransitionable } from '../failures/shipping-failures';
import type { ShippingOrderStore } from '../ports/shipping-order-store';
import { shippingStatusAfter, STAMP_OF } from '../values/shipping-transition';

/**
 * A {@link ShippingOrderStore} held in memory, for the specs of whatever
 * consumes the port. It runs `describeShippingOrderStoreContract`, so every
 * move is conditional on the status it is legal from, as the Mongo store's are.
 */
export const makeInMemoryShippingOrderStore = (): ShippingOrderStore => {
  const orders = new Map<string, ShippingOrder>();
  const commands = new Map<string, ShippingOrder>();
  const key = (organizationId: string, id: string) => `${organizationId}/${id}`;

  /** A stored copy, through the same serialization a real store applies. */
  const copy = (order: ShippingOrder) =>
    Effect.runSync(
      deserializeSingleEntity(ShippingOrder, {
        ...serializeEntity(ShippingOrder, order),
        id: order.id,
      }),
    ) as ShippingOrder;

  return {
    get: (organizationId, id) =>
      Effect.sync(() => {
        const order = orders.get(key(organizationId, id));
        return order === undefined ? undefined : copy(order);
      }),
    open: (organizationId, order, commandId) =>
      Effect.sync(() => {
        const first =
          commandId === undefined ? undefined : commands.get(commandId);
        if (first !== undefined)
          return { _tag: 'replayed', order: copy(first) };
        const opened = copy(order);
        opened.status = 'awaiting-dispatch';
        orders.set(key(organizationId, String(order.id)), opened);
        if (commandId !== undefined) commands.set(commandId, opened);
        return { _tag: 'opened', order: copy(opened) };
      }),
    transition: (organizationId, id, transition, at, commandId) =>
      Effect.suspend(
        (): Effect.Effect<
          ShippingOrder,
          NotFound | ShippingOrderNotTransitionable
        > => {
          const first =
            commandId === undefined ? undefined : commands.get(commandId);
          if (first !== undefined) return Effect.succeed(copy(first));
          const order = orders.get(key(organizationId, id));
          if (order === undefined) {
            return Effect.fail(new NotFound({ entity: 'shipping-order' }));
          }
          const to = shippingStatusAfter(order.status, transition);
          if (to === undefined) {
            return Effect.fail(
              new ShippingOrderNotTransitionable({
                shippingOrderId: id,
                standing: order.status,
                transition,
              }),
            );
          }
          order.status = to;
          const stamp = STAMP_OF[transition];
          if (stamp !== undefined) order[stamp] = at;
          if (commandId !== undefined) commands.set(commandId, copy(order));
          return Effect.succeed(copy(order));
        },
      ),
  };
};
