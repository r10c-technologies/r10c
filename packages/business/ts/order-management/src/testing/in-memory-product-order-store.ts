import {
  deserializeSingleEntity,
  NotFound,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';

import { CheckoutGroup } from '../entities/checkout-group';
import { ProductOrder } from '../entities/product-order';
import type {
  CheckoutGroupStore,
  OrderPlacement,
  ProductOrderStore,
} from '../ports/product-order-store';
import { type OrderStatus } from '../values/order-status';
import { orderStatusAfter } from '../values/order-transition';

/**
 * A {@link ProductOrderStore} and a {@link CheckoutGroupStore} held in memory
 * over one shared map of groups, for the specs of whatever consumes the ports.
 * They run `describeProductOrderStoreContract`, so every move is conditional on
 * the statuses it is legal from, the way the Mongo store's writes are.
 */
export const makeInMemoryOrderStores = (): {
  readonly orders: ProductOrderStore;
  readonly groups: CheckoutGroupStore;
} => {
  const orders = new Map<string, ProductOrder>();
  const groups = new Map<string, CheckoutGroup>();
  const claimedFrom = new Map<string, OrderStatus>();
  const commands = new Map<string, unknown>();
  const events = new Set<string>();

  const copyOrder = (order: ProductOrder) =>
    Effect.runSync(
      deserializeSingleEntity(ProductOrder, {
        ...serializeEntity(ProductOrder, order),
        id: order.id,
      }),
    ) as ProductOrder;

  const copyGroup = (group: CheckoutGroup) =>
    Effect.runSync(
      deserializeSingleEntity(CheckoutGroup, {
        ...serializeEntity(CheckoutGroup, group),
        id: group.id,
      }),
    ) as CheckoutGroup;

  /** Runs `step` once per command, the way a unit's command claim does. */
  const once = <A>(
    commandId: string | undefined,
    step: () => A | undefined,
  ): A | 'replayed' | undefined => {
    if (commandId !== undefined && commands.has(commandId)) return 'replayed';
    const done = step();
    if (done !== undefined && commandId !== undefined) {
      commands.set(commandId, done);
    }
    return done;
  };

  const shift = (orderId: string, from: OrderStatus, to: OrderStatus) => {
    const order = orders.get(orderId);
    if (order?.status !== from) return undefined;
    order.status = to;
    return copyOrder(order);
  };

  const orderStore: ProductOrderStore = {
    get: orderId =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        return order === undefined ? undefined : copyOrder(order);
      }),
    forGroup: groupId =>
      Effect.sync(() =>
        Array.from(orders.values())
          .filter(order => order.groupId === groupId)
          .map(copyOrder),
      ),
    place: (order, commandId) =>
      Effect.suspend((): Effect.Effect<OrderPlacement, NotFound> => {
        const first =
          commandId === undefined ? undefined : commands.get(commandId);
        if (first instanceof ProductOrder) {
          return Effect.succeed({
            _tag: 'replayed' as const,
            order: copyOrder(first),
          });
        }
        const group = groups.get(order.groupId);
        if (group === undefined) {
          return Effect.fail(new NotFound({ entity: 'checkout-group' }));
        }
        group.orderIds = [...group.orderIds, String(order.id)];
        orders.set(String(order.id), copyOrder(order));
        if (commandId !== undefined) commands.set(commandId, copyOrder(order));
        return Effect.succeed({ _tag: 'placed' as const, order });
      }),
    remove: orderId => Effect.sync(() => orders.delete(orderId)),
    move: (orderId, transition, commandId) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order === undefined) return undefined;
        // A repeated command answers the order as it stands.
        if (commandId !== undefined && commands.has(commandId)) {
          return copyOrder(order);
        }
        const to = orderStatusAfter(order.status, transition);
        if (to === undefined) return undefined;
        order.status = to;
        if (commandId !== undefined) commands.set(commandId, true);
        return copyOrder(order);
      }),
    claimCancellation: (orderId, commandId) =>
      Effect.sync(() => {
        const claimed = once(commandId, () => {
          const from = orders.get(orderId)?.status ?? 'pending';
          const to = orderStatusAfter(from, 'claim-cancel');
          if (to === undefined) return undefined;
          claimedFrom.set(orderId, from);
          return shift(orderId, from, to);
        });
        if (claimed === 'replayed') return { _tag: 'replayed' };
        return claimed === undefined
          ? { _tag: 'notClaimable' }
          : { _tag: 'claimed', order: claimed };
      }),
    releaseCancellation: orderId =>
      Effect.sync(() => {
        const released = shift(
          orderId,
          'cancelling',
          claimedFrom.get(orderId) ?? 'paid',
        );
        claimedFrom.delete(orderId);
        return released !== undefined;
      }),
    settleCancellation: (orderId, commandId) =>
      Effect.sync(() => {
        const settled = once(commandId, () =>
          shift(orderId, 'cancelling', 'cancelled'),
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

  const groupStore: CheckoutGroupStore = {
    get: groupId =>
      Effect.sync(() => {
        const group = groups.get(groupId);
        return group === undefined ? undefined : copyGroup(group);
      }),
    open: (group, commandId) =>
      Effect.sync(() => {
        const first =
          commandId === undefined ? undefined : commands.get(commandId);
        if (first instanceof CheckoutGroup) {
          return { _tag: 'replayed' as const, group: copyGroup(first) };
        }
        groups.set(String(group.id), copyGroup(group));
        if (commandId !== undefined) commands.set(commandId, copyGroup(group));
        return { _tag: 'opened' as const, group: copyGroup(group) };
      }),
    remove: groupId => Effect.sync(() => groups.delete(groupId)),
  };

  return { orders: orderStore, groups: groupStore };
};
