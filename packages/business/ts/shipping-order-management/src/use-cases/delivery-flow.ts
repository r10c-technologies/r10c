import { IdempotencyKeyTag } from '@entifix/business';
import { NotFound } from '@entifix/core';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import { Effect, Option } from 'effect';

import type { ShippingOrder } from '../entities/shipping-order';
import { ShippingOrderStoreTag } from '../ports/shipping-order-store';
import { decideShippingMove } from './shipping-order-verbs';

/** The recipe a dispatch starts, by its name in the coordinator's catalog. */
export const DELIVERY_RECIPE = 'delivery';

/**
 * What a delivery starts from, all of it read off the stored shipment, which
 * is the authority on it. The coordinator states the rest — the vendor's
 * entitlements and the windows the flow waits in — and overwrites anything
 * else said about them.
 */
export const deliveryInput = (
  organizationId: string,
  order: ShippingOrder,
) => ({
  shippingOrderId: String(order.id),
  orderId: order.orderId,
  groupId: order.groupId,
  vendorId: organizationId,
  paymentMethod: order.paymentMethod,
  amountDue: order.amountDue,
  currency: order.currency,
  lines: order.lines.map(line => ({
    offeringId: line.offeringId,
    quantity: line.quantity,
  })),
});

/**
 * A vendor dispatching one of their shipments: the delivery flow started
 * (ADR 0070), answered with the flow to follow — never its outcome. The
 * dispatch itself is the flow's pivot, so a shipment held by a cancellation in
 * flight is refused there, and exactly one of the two wins.
 *
 * Checked here first all the same: a shipment already dispatched, held or
 * withdrawn refuses with a `409` the vendor sees at once, rather than as a
 * flow that started only to fail.
 *
 * Keyed on the shipment **and** on the request, as a cancellation is: a
 * retried request is the same flow, and a dispatch whose flow failed — its
 * shipment held, then released — can be asked again.
 */
export const dispatchShipment = (input: {
  readonly organizationId: string;
  readonly shippingOrderId: string;
}) =>
  Effect.gen(function* () {
    const store = yield* ShippingOrderStoreTag;
    const order = yield* store.get(input.organizationId, input.shippingOrderId);
    if (order === undefined)
      return yield* new NotFound({ entity: 'shipping-order' });
    yield* decideShippingMove(order, 'dispatch');
    const requestKey = Option.getOrUndefined(
      yield* Effect.serviceOption(IdempotencyKeyTag),
    );
    const flows = yield* FlowStarterTag;
    return yield* flows.start(
      DELIVERY_RECIPE,
      deliveryInput(input.organizationId, order),
      `delivery:${input.shippingOrderId}:${requestKey ?? globalThis.crypto.randomUUID()}`,
    );
  });
