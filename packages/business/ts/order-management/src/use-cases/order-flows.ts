import { IdempotencyKeyTag } from '@entifix/business';
import { NotFound } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import { Effect, Option } from 'effect';

import type { CheckoutGroup } from '../entities/checkout-group';
import type { ProductOrder } from '../entities/product-order';
import {
  CancelNotAuthorized,
  OrderNotTransitionable,
  PaymentPending,
} from '../failures/order-failures';
import {
  CheckoutGroupStoreTag,
  ProductOrderStoreTag,
} from '../ports/product-order-store';
import { verifyCancelCapability } from '../values/cancel-capability';
import type { OrderScope } from '../values/order-scope';
import type { OrderTransition } from '../values/order-transition';
import { CancelProductOrderUC } from './cancel-product-order';

const MILLISECONDS = 1000;

/** The recipe a cancellation runs on the coordinator. */
export const CANCELLATION_RECIPE = 'cancellation';

/** A group id is the checkout flow's id: a UUID, and nothing else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An order outside the caller's scope answers exactly as an absent one does:
 * telling a vendor another vendor's order exists is a leak.
 */
const orderNotFound = new NotFound({ entity: 'product-order' });

/** The order a staff verb acts on, when it is the caller's to act on. */
const orderInScope = (orderId: string, scope: OrderScope) =>
  Effect.gen(function* () {
    if (scope.kind === 'buyer' || scope.kind === 'nothing') {
      return yield* orderNotFound;
    }
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(orderId);
    if (
      order === undefined ||
      (scope.kind === 'vendor' && order.vendorId !== scope.organizationId)
    ) {
      return yield* orderNotFound;
    }
    return order;
  });

/**
 * Open a checkout group — the checkout's first write, before any vendor's
 * order. The id is the flow's, handed in; the placing time and the buyer's
 * cancel window are this domain's to stamp, and the window opens only for a
 * group that carries a capability digest: a counter sale has no buyer to hold
 * one.
 */
export const openGroup = (input: {
  readonly group: CheckoutGroup;
  readonly commandId: string | undefined;
  readonly cancelWindowSeconds: number;
}) =>
  Effect.gen(function* () {
    const { group } = input;
    if (typeof group.id !== 'string' || !UUID.test(group.id)) {
      return yield* new InvalidBody({
        reason: 'a checkout group is opened under its flow’s id',
      });
    }
    group.orderIds = [];
    group.placedAt = new Date();
    group.cancelWindowEndsAt =
      group.cancelDigest === undefined || group.cancelDigest === ''
        ? undefined
        : new Date(
            group.placedAt.getTime() + input.cancelWindowSeconds * MILLISECONDS,
          );
    const groups = yield* CheckoutGroupStoreTag;
    return yield* groups.open(group, input.commandId);
  });

/**
 * Why a write's lines cannot be one vendor's order, or `undefined` when they
 * can. A line names no vendor once stored, but the write that carries it may —
 * the checkout prices each line from the published offering, vendor and all —
 * and a line naming another vendor is a basket split wrongly upstream.
 */
export const foreignLinesProblem = (
  vendorId: string,
  lines: readonly unknown[],
): string | undefined =>
  lines.some(line => {
    const named = (line as { vendorId?: unknown } | null)?.vendorId;
    return named !== undefined && named !== vendorId;
  })
    ? 'every line of an order must be its own vendor’s'
    : undefined;

/**
 * Place one vendor's order — the checkout's per-vendor write — into a group
 * already opened. The id, the status and the placing time are this domain's
 * to write, never the caller's.
 */
export const placeOrder = (input: {
  readonly order: ProductOrder;
  readonly rawLines: readonly unknown[];
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { order } = input;
    if (order.items.length === 0) {
      return yield* new InvalidBody({
        reason: 'an order must carry at least one item',
      });
    }
    if (order.vendorId === '' || order.groupId === '') {
      return yield* new InvalidBody({
        reason: 'an order belongs to one vendor in one checkout group',
      });
    }
    const foreign = foreignLinesProblem(order.vendorId, input.rawLines);
    if (foreign !== undefined)
      return yield* new InvalidBody({ reason: foreign });

    order.id = globalThis.crypto.randomUUID();
    order.status = 'pending';
    order.placedAt = new Date();

    const store = yield* ProductOrderStoreTag;
    return yield* store.place(order, input.commandId);
  });

/**
 * One crossing move a flow makes on a vendor's order — confirm it, mark it
 * dispatched, close it — conditional on where it stands, and refused when it
 * stands anywhere else.
 */
export const moveOrder = (input: {
  readonly orderId: string;
  readonly transition: Exclude<
    OrderTransition,
    'claim-cancel' | 'settle-cancel'
  >;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const moved = yield* store.move(
      input.orderId,
      input.transition,
      input.commandId,
    );
    if (moved !== undefined) return moved;
    const order = yield* store.get(input.orderId);
    if (order === undefined) return yield* orderNotFound;
    return yield* new OrderNotTransitionable({
      orderId: input.orderId,
      standing: order.status,
      transition: input.transition,
    });
  });

/**
 * What the cancellation flow starts from, all of it read off the stored order —
 * which is the authority on it: the order, its vendor, how it was paid, the
 * lines to put back, and whether a shipment was opened for it. A sale handed
 * over at a counter shipped nothing; the coordinator narrows the rest by
 * whether the vendor ships at all. The organization comes from the *order*,
 * because the buyer behind a cancellation names none.
 */
export const cancellationInput = (
  order: ProductOrder,
  capabilityDigest?: string,
) => ({
  orderId: String(order.id),
  vendorId: order.vendorId,
  paymentMethod: order.paymentMethod,
  lines: order.items.map(line => ({
    offeringId: line.offeringId,
    quantity: line.quantity,
  })),
  shipped: order.channel === undefined || order.channel.type === 'storefront',
  ...(order.buyerId === undefined ? {} : { buyerId: order.buyerId }),
  ...(capabilityDigest === undefined ? {} : { capabilityDigest }),
});

/**
 * Start the cancellation flow, having already decided the caller may, and
 * answer the flow to follow — never its outcome (ADR 0066, ADR 0073). A
 * refused refund or an order already past cancelling arrives as the flow's
 * failure.
 *
 * Keyed on the order **and** on the request: the caller's `Idempotency-Key`
 * when it sent one, so a retried request is the same flow, and a fresh key
 * otherwise. Never on the order alone — a cancellation whose refund was
 * declined must be askable again. Two starts racing on one order are safe,
 * because the claim is the lock: the second fails there and moves nothing.
 *
 * ⚠️ **This service is both the caller and a participant**, the cycle ADR 0058
 * §6 accepts: a cancellation's authority is a buyer's capability or a vendor's
 * session, and neither is verifiable anywhere but here.
 */
const startCancellation = (order: ProductOrder, capabilityDigest?: string) =>
  Effect.gen(function* () {
    const requestKey = Option.getOrUndefined(
      yield* Effect.serviceOption(IdempotencyKeyTag),
    );
    const flows = yield* FlowStarterTag;
    return yield* flows.start(
      CANCELLATION_RECIPE,
      cancellationInput(order, capabilityDigest),
      `cancellation:${String(order.id)}:${requestKey ?? globalThis.crypto.randomUUID()}`,
    );
  });

/**
 * A vendor or an operator cancelling one vendor order — the vendor's own,
 * since the narrowing never shows them another's.
 */
export const cancelOrderAsStaff = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
}) =>
  Effect.gen(function* () {
    const order = yield* orderInScope(input.orderId, input.scope);
    yield* CancelProductOrderUC.run(order);
    return yield* startCancellation(order);
  });

/**
 * The group a buyer's capability opens, with nothing told about why it did not:
 * every capability failure answers alike, because saying which part was wrong
 * would teach a caller how to forge the rest.
 */
const groupForBuyer = (groupId: string, nonce: string | undefined) =>
  Effect.gen(function* () {
    const groups = yield* CheckoutGroupStoreTag;
    const group = yield* groups.get(groupId);
    const refusal =
      group === undefined
        ? 'noCapability'
        : verifyCancelCapability(group, nonce, new Date());
    if (group === undefined || refusal !== undefined) {
      // On the trace rather than in a log: the failure is the answer, and only
      // the slice shell logs (ADR 0064).
      yield* Effect.annotateCurrentSpan({
        'checkout-group.id': groupId,
        'checkout-group.capability.refusal': String(refusal),
      });
      return yield* new CancelNotAuthorized();
    }
    return group;
  });

/**
 * A buyer cancelling one vendor order with the capability their receipt
 * carried — the group's — and no session at all.
 */
export const cancelOrderAsBuyer = (input: {
  readonly orderId: string;
  readonly nonce: string | undefined;
  /** The digest of the capability the buyer follows this cancellation by. */
  readonly capabilityDigest?: string;
}) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(input.orderId);
    if (order === undefined) return yield* new CancelNotAuthorized();
    yield* groupForBuyer(order.groupId, input.nonce);
    // The payment is not confirmed yet: a state the buyer can wait out.
    if (order.status === 'pending') {
      return yield* new PaymentPending({ orderId: input.orderId });
    }
    yield* CancelProductOrderUC.run(order);
    return yield* startCancellation(order, input.capabilityDigest);
  });

/**
 * The buyer's receipt read back by the same capability, with no session: the
 * group and every vendor order in it. What a storefront that waited on a flow
 * reads once the flow completed, knowing only the flow's id — which is the
 * group's (ADR 0053, as revised by ADR 0069).
 */
export const buyerReceipt = (input: {
  readonly groupId: string;
  readonly nonce: string | undefined;
}) =>
  Effect.gen(function* () {
    const group = yield* groupForBuyer(input.groupId, input.nonce);
    const store = yield* ProductOrderStoreTag;
    const orders = yield* store.forGroup(input.groupId);
    return { group, orders };
  });
