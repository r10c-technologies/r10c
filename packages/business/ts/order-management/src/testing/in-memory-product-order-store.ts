import {
  deserializeSingleEntity,
  NotFound,
  serializeEntity,
} from '@entifix/core';
import { drawOrderNumber } from '@r10c/business-ts-order-contracts';
import { Effect } from 'effect';

import { CheckoutGroup } from '../entities/checkout-group';
import { ProductOrder } from '../entities/product-order';
import type {
  CheckoutGroupStore,
  OrderPlacement,
  ProductOrderStore,
} from '../ports/product-order-store';
import { FISCAL_DUE_STATUSES } from '../values/fiscal-document';
import { type OrderStatus } from '../values/order-status';
import { MOVE_STAMP_OF, orderStatusAfter } from '../values/order-transition';

/** The statuses a group's contact waits for every order to reach. */
const CLOSED: readonly OrderStatus[] = ['fulfilled', 'cancelled'];

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

  /**
   * A number unique among `taken`: the one drawn, or a fresh draw while it
   * collides — the redraw the Mongo store makes on its unique index. A record
   * written with none is given one, as the Mongo store gives it.
   */
  const unique = (number: string, taken: Iterable<{ number: string }>) => {
    const used = new Set(Array.from(taken, record => record.number));
    let candidate = number === '' ? drawOrderNumber() : number;
    while (used.has(candidate)) candidate = drawOrderNumber();
    return candidate;
  };

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
        order.number = unique(order.number, orders.values());
        orders.set(String(order.id), copyOrder(order));
        if (commandId !== undefined) commands.set(commandId, copyOrder(order));
        return Effect.succeed({ _tag: 'placed' as const, order });
      }),
    remove: orderId => Effect.sync(() => orders.delete(orderId)),
    move: (orderId, transition, commandId, guide) =>
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
        const stamp = MOVE_STAMP_OF[transition];
        if (stamp !== undefined) order[stamp] = new Date();
        if (transition === 'mark-dispatched' && guide !== undefined) {
          Object.assign(order, guide);
        }
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
    awaitPayment: (orderId, paymentDueAt, commandId) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order === undefined) return undefined;
        if (commandId !== undefined && commands.has(commandId)) {
          return copyOrder(order);
        }
        if (order.status !== 'pending') return undefined;
        order.status = 'awaiting-payment';
        order.paymentDueAt = paymentDueAt;
        if (commandId !== undefined) commands.set(commandId, true);
        return copyOrder(order);
      }),
    confirmPayment: (orderId, confirmation) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order?.status !== 'awaiting-payment') return undefined;
        order.status = 'paid';
        order.paidAt = confirmation.confirmedAt;
        order.paymentReference = confirmation.reference;
        order.paymentConfirmedBy = confirmation.confirmedBy;
        order.paymentConfirmedAt = confirmation.confirmedAt;
        return copyOrder(order);
      }),
    endAwaitingPayment: (orderId, cause, now) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order?.status !== 'awaiting-payment') return undefined;
        if (
          cause === 'payment-expired' &&
          // Every waiting order was stamped by `awaitPayment`.
          !((order.paymentDueAt as Date).getTime() < now.getTime())
        ) {
          return undefined;
        }
        order.status = 'cancelled';
        order.cancelCause = cause;
        return copyOrder(order);
      }),
    overduePayments: now =>
      Effect.sync(() =>
        Array.from(orders.values())
          .filter(
            order =>
              order.status === 'awaiting-payment' &&
              (order.paymentDueAt as Date).getTime() < now.getTime(),
          )
          .map(order => String(order.id)),
      ),
    setPaymentLink: (orderId, link) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order?.status !== 'awaiting-payment') return undefined;
        order.paymentLinkUrl = link.url;
        order.paymentLinkProviderKey = link.providerKey;
        order.paymentLinkProviderName = link.providerName;
        order.paymentLinkSetBy = link.setBy;
        order.paymentLinkSetAt = link.setAt;
        return copyOrder(order);
      }),
    fiscalDue: retryBefore =>
      Effect.sync(() => {
        const free = (order: ProductOrder) =>
          order.fiscalAttemptAt === undefined ||
          order.fiscalAttemptAt.getTime() < retryBefore.getTime();
        const all = Array.from(orders.values()).filter(free);
        return {
          certify: all
            .filter(
              order =>
                (FISCAL_DUE_STATUSES as readonly string[]).includes(
                  order.status,
                ) && order.fiscalAuthorization === undefined,
            )
            .map(order => String(order.id)),
          void: all
            .filter(
              order =>
                order.status === 'cancelled' &&
                order.fiscalAuthorization !== undefined &&
                order.fiscalVoidedAt === undefined,
            )
            .map(order => String(order.id)),
        };
      }),
    claimFiscalAttempt: (orderId, now, retryBefore) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order === undefined) return undefined;
        const last = order.fiscalAttemptAt;
        if (last !== undefined && last.getTime() >= retryBefore.getTime()) {
          return undefined;
        }
        order.fiscalAttemptAt = now;
        return copyOrder(order);
      }),
    recordFiscalDocument: (orderId, document) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order === undefined || order.fiscalAuthorization !== undefined) {
          return false;
        }
        order.fiscalDocumentType = document.type;
        order.fiscalAuthorization = document.authorization;
        order.fiscalSeries = document.series;
        order.fiscalNumber = document.number;
        order.fiscalCertifiedAt = document.certifiedAt;
        order.fiscalAttemptAt = undefined;
        order.fiscalFailure = undefined;
        return true;
      }),
    recordFiscalVoid: (orderId, annulment) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (
          order?.status !== 'cancelled' ||
          order.fiscalAuthorization === undefined ||
          order.fiscalVoidedAt !== undefined
        ) {
          return false;
        }
        order.fiscalVoidAuthorization = annulment.authorization;
        order.fiscalVoidedAt = annulment.voidedAt;
        order.fiscalAttemptAt = undefined;
        order.fiscalFailure = undefined;
        return true;
      }),
    recordFiscalFailure: (orderId, reason) =>
      Effect.sync(() => {
        const order = orders.get(orderId);
        if (order === undefined) return false;
        order.fiscalFailure = reason;
        return true;
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
        group.number = unique(group.number, groups.values());
        groups.set(String(group.id), copyGroup(group));
        if (commandId !== undefined) commands.set(commandId, copyGroup(group));
        return { _tag: 'opened' as const, group: copyGroup(group) };
      }),
    remove: groupId => Effect.sync(() => groups.delete(groupId)),
    issueAccess: (groupId, grant, notSentSince) =>
      Effect.sync(() => {
        const group = groups.get(groupId);
        if (group === undefined) return undefined;
        const lastSent = group.accessSentAt?.getTime();
        if (
          notSentSince !== undefined &&
          lastSent !== undefined &&
          lastSent >= notSentSince.getTime()
        ) {
          return undefined;
        }
        group.accessDigest = grant.digest;
        group.accessExpiresAt = grant.expiresAt;
        group.accessSentAt = grant.sentAt;
        return copyGroup(group);
      }),
    redeemAccess: (accessDigest, cancelDigest, now) =>
      Effect.sync(() => {
        const group = Array.from(groups.values()).find(
          candidate =>
            candidate.accessDigest === accessDigest &&
            // `NaN` for a group with no link, which is never later than now.
            Number(candidate.accessExpiresAt) > now.getTime(),
        );
        if (group === undefined) return undefined;
        group.cancelDigest = cancelDigest;
        group.accessDigest = undefined;
        group.accessExpiresAt = undefined;
        return String(group.id);
      }),
    findByNumber: number =>
      Effect.sync(() => {
        const groupId =
          Array.from(groups.values()).find(group => group.number === number)
            ?.id ??
          Array.from(orders.values()).find(order => order.number === number)
            ?.groupId;
        const group =
          groupId === undefined ? undefined : groups.get(String(groupId));
        return group === undefined ? undefined : copyGroup(group);
      }),
    redactEndedReceipts: now =>
      Effect.sync(() => {
        let redacted = 0;
        for (const group of groups.values()) {
          if (
            group.contact.length === 0 ||
            !(Number(group.receiptEndsAt) < now.getTime())
          ) {
            continue;
          }
          const open = Array.from(orders.values()).some(
            order =>
              order.groupId === String(group.id) &&
              !CLOSED.includes(order.status),
          );
          if (open) continue;
          group.contact = [];
          group.redactedAt = now;
          redacted += 1;
          // The opening's remembered copy, as the command inbox holds it.
          for (const remembered of commands.values()) {
            if (
              remembered instanceof CheckoutGroup &&
              remembered.number === group.number
            ) {
              remembered.contact = [];
            }
          }
        }
        return redacted;
      }),
  };

  return { orders: orderStore, groups: groupStore };
};
