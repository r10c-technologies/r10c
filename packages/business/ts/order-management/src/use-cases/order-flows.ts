import { NotFound, UpstreamUnavailable } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { RefundDeclined } from '@r10c/business-ts-payment-contracts';
import { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { Effect } from 'effect';

import type { ProductOrder } from '../entities/product-order';
import {
  CancelNotAuthorized,
  OrderNotCancellable,
  OrderNotFulfillable,
  PaymentPending,
} from '../failures/order-failures';
import { ProductOrderStoreTag } from '../ports/product-order-store';
import { verifyCancelCapability } from '../values/cancel-capability';
import type { OrderScope } from '../values/order-scope';
import { CancelProductOrderUC } from './cancel-product-order';
import { FulfilProductOrderUC } from './fulfil-product-order';

const MILLISECONDS = 1000;

/** The flow a cancellation runs on the coordinator. */
export const CANCELLATION_SAGA = 'cancellation';

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
    const vendor = scope.kind === 'vendor' ? scope.organizationId : undefined;
    if (
      order === undefined ||
      (vendor !== undefined &&
        !order.items.some(line => line.vendorId === vendor))
    ) {
      return yield* orderNotFound;
    }
    return { order, vendor };
  });

/**
 * Place an order — the checkout saga's `write-order` step.
 *
 * The id, the status and the placing time are this domain's to write, never
 * the caller's. The buyer's cancel window opens here, and only for an order
 * that carries a capability digest: a counter sale has no buyer to hold one.
 */
export const placeOrder = (input: {
  readonly order: ProductOrder;
  readonly commandId: string | undefined;
  readonly cancelWindowSeconds: number;
}) =>
  Effect.gen(function* () {
    const { order } = input;
    if (order.items.length === 0) {
      return yield* new InvalidBody({
        reason: 'an order must carry at least one item',
      });
    }
    order.id = globalThis.crypto.randomUUID();
    order.status = 'pending';
    order.placedAt = new Date();
    order.cancelWindowEndsAt =
      order.cancelDigest === undefined || order.cancelDigest === ''
        ? undefined
        : new Date(
            order.placedAt.getTime() + input.cancelWindowSeconds * MILLISECONDS,
          );

    const store = yield* ProductOrderStoreTag;
    return yield* store.place(order, input.commandId);
  });

/**
 * Fulfil an order's lines — per line, because one vendor cannot state
 * something true about another's.
 */
export const fulfilOrder = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
}) =>
  Effect.gen(function* () {
    const { order, vendor } = yield* orderInScope(input.orderId, input.scope);

    // ⚠️ **Decided over plain lines and stamped back onto the items.** The
    // decider stamps a line by spreading it, and an `OrderItem` holds its
    // members in private fields: a spread of one copies nothing, and the line
    // it returned would have lost its offering, its quantity and its price.
    const decided = yield* FulfilProductOrderUC.run(
      order,
      order.items.map(item => ({
        vendorId: item.vendorId,
        fulfilledAt: item.fulfilledAt,
      })),
      vendor,
      new Date(),
    );
    order.items.forEach((item, index) => {
      item.fulfilledAt = decided.lines[index]?.fulfilledAt;
    });
    // Conditional on `paid` again: a cancellation claiming it in between wins.
    const store = yield* ProductOrderStoreTag;
    const updated = yield* store.fulfil(
      input.orderId,
      order.items,
      decided.status,
    );
    if (updated === undefined) {
      return yield* new OrderNotFulfillable({
        orderId: input.orderId,
        reason: 'the order changed while it was being fulfilled',
      });
    }
    return updated;
  });

/**
 * What the cancellation flow is given: claim, refund, put each line's goods
 * back in its vendor's stock, close the record. The organization comes from
 * the *line*, because the buyer behind a cancellation names none.
 */
export const cancellationInputs = (order: ProductOrder) => ({
  claim: [{ body: { orderId: order.id } }],
  refund: [{ body: { orderId: order.id } }],
  'restore-stock': order.items.map(line => ({
    organizationId: line.vendorId,
    body: {
      meta: { type: 'entity', entity: 'stock-movement' },
      data: { offeringId: line.offeringId, quantity: line.quantity },
    },
  })),
  settle: [{ body: { orderId: order.id } }],
});

/**
 * Which step refused, as the failure the browser can render. A refused refund
 * is a different fact for the customer from an order past cancelling: the
 * order is still theirs and still paid for.
 */
const refusalOf = (order: ProductOrder, result: unknown) => {
  const orderId = String(order.id);
  const refusedStep = (result as { refusedStep?: unknown } | undefined)
    ?.refusedStep;
  return refusedStep === 'refund'
    ? new RefundDeclined({ orderId })
    : new OrderNotCancellable({
        orderId,
        reason: 'a step of the cancellation refused, and nothing moved',
      });
};

/**
 * Start the cancellation flow, having already decided the caller may.
 *
 * ⚠️ **This service is both the caller and a participant**, the cycle ADR 0058
 * §6 accepts: a cancellation's authority is a buyer's capability or a vendor's
 * session, and neither is verifiable anywhere but here.
 */
const startCancellation = (order: ProductOrder) =>
  Effect.gen(function* () {
    const sagas = yield* SagaStarterTag;
    // Keyed on the order: one order is cancelled once, so asking again is a
    // replay of the first answer rather than a second flow.
    const outcome = yield* sagas.start(
      CANCELLATION_SAGA,
      cancellationInputs(order),
      `cancellation:${String(order.id)}`,
    );
    if (outcome._tag === 'compensated') {
      // Fully compensated: nothing moved, and the order is exactly as it was.
      return yield* refusalOf(order, outcome.result);
    }
    if (outcome._tag === 'failed') {
      // Stranded past the pivot, or the coordinator itself failed. Either way
      // the order is visibly `cancelling`, which a sweep or a person can act on.
      return yield* new UpstreamUnavailable({
        upstream: 'transaction-service',
      });
    }
    // Read back rather than assumed: the flow's last step wrote `cancelled`,
    // and echoing what this believed a moment ago would be a receipt that
    // guesses.
    const store = yield* ProductOrderStoreTag;
    return (yield* store.get(String(order.id))) ?? order;
  });

/**
 * A vendor or an operator cancelling. A vendor may cancel only an order that
 * is theirs alone — the money was taken once, for the whole basket.
 */
export const cancelOrderAsStaff = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
}) =>
  Effect.gen(function* () {
    const { order, vendor } = yield* orderInScope(input.orderId, input.scope);
    yield* CancelProductOrderUC.run(order, order.items, vendor);
    return yield* startCancellation(order);
  });

/**
 * A buyer cancelling with the capability their receipt carried — no session
 * at all. Every capability failure answers alike: telling a caller which part
 * was wrong would teach them how to forge the rest.
 */
export const cancelOrderAsBuyer = (input: {
  readonly orderId: string;
  readonly nonce: string | undefined;
}) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(input.orderId);
    const refusal =
      order === undefined
        ? 'noCapability'
        : verifyCancelCapability(order, input.nonce, new Date());
    if (order === undefined || refusal !== undefined) {
      // On the trace rather than in a log: the failure is the answer, and only
      // the slice shell logs (ADR 0064).
      yield* Effect.annotateCurrentSpan({
        'order.id': input.orderId,
        'order.cancel.refusal': String(refusal),
      });
      return yield* new CancelNotAuthorized();
    }
    // The payment is not confirmed yet: a state the buyer can wait out.
    if (order.status === 'pending') {
      return yield* new PaymentPending({ orderId: input.orderId });
    }
    if (order.status !== 'paid') {
      return yield* new OrderNotCancellable({
        orderId: input.orderId,
        reason: `an order in '${order.status}' cannot be cancelled`,
      });
    }
    return yield* startCancellation(order);
  });
