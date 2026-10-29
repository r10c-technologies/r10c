import type { EntifixLogicError } from '@entifix/core';
import { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { Effect } from 'effect';

import type { ProductOrder } from '../entities/product-order';
import { ProductOrderStoreTag } from '../ports/product-order-store';
import { verifyCancelCapability } from '../values/cancel-capability';
import type { OrderScope } from '../values/order-scope';
import {
  CancelProductOrderUC,
  MULTI_VENDOR_ORDER,
  ORDER_NOT_CANCELLABLE,
  PAYMENT_PENDING,
} from './cancel-product-order';
import { FulfilProductOrderUC } from './fulfil-product-order';

const MILLISECONDS = 1000;

/** The flow a cancellation runs on the coordinator. */
export const CANCELLATION_SAGA = 'cancellation';

/** A request the domain refuses as it stands. */
export class OrderRefused {
  readonly _tag = 'OrderRefused';
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {}
}

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
      return yield* Effect.fail(
        new OrderRefused(
          'invalidBody',
          'an order must carry at least one item',
        ),
      );
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

/** How fulfilling went, for the route to answer. */
export type FulfilResult =
  | { readonly _tag: 'notFound' }
  | { readonly _tag: 'notFulfillable'; readonly detail: string }
  | { readonly _tag: 'fulfilled'; readonly order: ProductOrder };

/**
 * Fulfil an order's lines — per line, because one vendor cannot state
 * something true about another's. An order outside the caller's scope answers
 * exactly as an absent one does.
 */
export const fulfilOrder = (input: {
  readonly orderId: string;
  readonly scope: OrderScope;
}) =>
  Effect.gen(function* () {
    const { scope } = input;
    if (scope.kind === 'buyer' || scope.kind === 'nothing') {
      return { _tag: 'notFound' } as FulfilResult;
    }
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(input.orderId);
    const vendor = scope.kind === 'vendor' ? scope.organizationId : undefined;
    if (
      order === undefined ||
      (vendor !== undefined &&
        !order.items.some(line => line.vendorId === vendor))
    ) {
      return { _tag: 'notFound' } as FulfilResult;
    }
    if (order.status !== 'paid') {
      return {
        _tag: 'notFulfillable',
        detail: `an order in '${order.status}' cannot be fulfilled`,
      } as FulfilResult;
    }

    // ⚠️ **Decided over plain lines and stamped back onto the items.** The
    // decider stamps a line by spreading it, and an `OrderItem` holds its
    // members in private fields: a spread of one copies nothing, and the line
    // it returned would have lost its offering, its quantity and its price.
    const decided = FulfilProductOrderUC.run(
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
    const updated = yield* store.fulfil(
      input.orderId,
      order.items,
      decided.status,
    );
    return (
      updated === undefined
        ? {
            _tag: 'notFulfillable',
            detail: 'the order changed while it was being fulfilled',
          }
        : { _tag: 'fulfilled', order: updated }
    ) as FulfilResult;
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

/** How a cancellation went, for the route to answer. */
export type CancelResult =
  | { readonly _tag: 'notFound' }
  | { readonly _tag: 'notAuthorized'; readonly refusal: string }
  | { readonly _tag: 'refused'; readonly code: string }
  | { readonly _tag: 'cancelled'; readonly order: ProductOrder }
  | { readonly _tag: 'failed'; readonly status: number };

/**
 * Which step refused, as a code the browser can render. A refused refund is a
 * different fact for the customer from an order past cancelling: the order is
 * still theirs and still paid for.
 */
const refusalCode = (result: unknown): string => {
  const outcomes = (result as { data?: { outcomes?: unknown } } | undefined)
    ?.data?.outcomes;
  if (!Array.isArray(outcomes)) return ORDER_NOT_CANCELLABLE;
  const failed = outcomes.find(
    (outcome: { error?: unknown }) => outcome.error !== undefined,
  ) as { stepId?: string } | undefined;
  return failed?.stepId === 'refund' ? 'refundDeclined' : ORDER_NOT_CANCELLABLE;
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
    if (outcome._tag === 'completed') {
      // Read back rather than assumed: the flow's last step wrote `cancelled`,
      // and echoing what this believed a moment ago would be a receipt that
      // guesses.
      const store = yield* ProductOrderStoreTag;
      const settled = yield* store.get(String(order.id));
      return { _tag: 'cancelled', order: settled ?? order } as CancelResult;
    }
    if (outcome._tag === 'compensated') {
      // Fully compensated: nothing moved, and the order is exactly as it was.
      return {
        _tag: 'refused',
        code: refusalCode(outcome.result),
      } as CancelResult;
    }
    // Stranded past the pivot, or the coordinator itself failed. Either way the
    // order is visibly `cancelling`, which a sweep or a person can act on.
    return { _tag: 'failed', status: outcome.status } as CancelResult;
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
    const { scope } = input;
    if (scope.kind === 'buyer' || scope.kind === 'nothing') {
      return { _tag: 'notFound' } as CancelResult;
    }
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(input.orderId);
    const vendor = scope.kind === 'vendor' ? scope.organizationId : undefined;
    if (
      order === undefined ||
      (vendor !== undefined &&
        !order.items.some(line => line.vendorId === vendor))
    ) {
      return { _tag: 'notFound' } as CancelResult;
    }

    const refused = yield* Effect.try({
      try: () => CancelProductOrderUC.run(order, order.items, vendor),
      // The decider names every refusal's code on the error it throws, and
      // throws nothing else.
      catch: error =>
        (error as EntifixLogicError & { details: { code: string } }).details
          .code,
    }).pipe(
      Effect.as(undefined),
      Effect.catch(code => Effect.succeed(code)),
    );
    if (refused !== undefined) {
      return { _tag: 'refused', code: refused } as CancelResult;
    }
    return yield* startCancellation(order);
  });

/** The code a refusal names, for the multi-vendor case a vendor can act on. */
export const isMultiVendorRefusal = (code: string) =>
  code === MULTI_VENDOR_ORDER;

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
      // On the trace rather than in a log: the outcome below is the answer,
      // and only the slice shell logs (ADR 0064).
      yield* Effect.annotateCurrentSpan({
        'order.id': input.orderId,
        'order.cancel.refusal': String(refusal),
      });
      return { _tag: 'notAuthorized', refusal } as CancelResult;
    }
    // The payment is not confirmed yet: a state the buyer can wait out.
    if (order.status === 'pending') {
      return { _tag: 'refused', code: PAYMENT_PENDING } as CancelResult;
    }
    if (order.status !== 'paid') {
      return { _tag: 'refused', code: ORDER_NOT_CANCELLABLE } as CancelResult;
    }
    return yield* startCancellation(order);
  });
