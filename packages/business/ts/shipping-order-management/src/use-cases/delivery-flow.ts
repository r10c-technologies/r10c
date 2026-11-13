import {
  EntityRepositoryFactoryTag,
  IdempotencyKeyTag,
} from '@entifix/business';
import {
  type BulkOutcome,
  type EntityId,
  type EntitySelection,
  loadRequestFor,
  NotFound,
} from '@entifix/core';
import { refuseSelectionAbove } from '@r10c/business-ts-common';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import { Effect, Option } from 'effect';

import { ShippingOrder } from '../entities/shipping-order';
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

/**
 * The most shipments one bulk dispatch takes, either select-all. A vendor's
 * worklist is a morning's parcels, not a warehouse, and every row starts a
 * flow; a larger selection is refused whole.
 */
export const BULK_DISPATCH_CAP = 200;

/**
 * A vendor dispatching a selection of their shipments: one delivery flow per
 * shipment, each through {@link dispatchShipment}, so every row is checked and
 * keyed exactly as a single dispatch is. One row's refusal — a shipment a
 * cancellation holds, one already dispatched — is that row's outcome and never
 * ends the run. A row answered `ok` started its flow; whether the parcel
 * actually left is the flow's to say, and arrives as a push.
 */
export const dispatchShipmentSelection = (input: {
  readonly organizationId: string;
  readonly selection: EntitySelection<ShippingOrder>;
}) =>
  Effect.gen(function* () {
    const { selection, organizationId } = input;
    // `Array.from`, never a spread: SWC's loose helper wraps a `Set`.
    const ids: readonly EntityId[] =
      selection.mode === 'ids'
        ? Array.from(selection.ids)
        : yield* Effect.gen(function* () {
            const factory = yield* EntityRepositoryFactoryTag;
            const shipments = yield* factory.for(ShippingOrder, {
              organizationId,
            });
            const page = yield* shipments.load<ShippingOrder>(
              loadRequestFor(selection, {
                page: 1,
                pageSize: BULK_DISPATCH_CAP + selection.excluded.size + 1,
              }),
            );
            const excluded = Array.from(selection.excluded).map(String);
            return page.items
              .map(item => item.id)
              .filter(id => !excluded.includes(String(id)));
          });
    // Refused whole, before any row is touched: acting on the first
    // BULK_DISPATCH_CAP rows and saying nothing about the rest is the silent
    // truncation ADR 0035 rules out.
    yield* refuseSelectionAbove(BULK_DISPATCH_CAP, ids.length);

    const outcomes: BulkOutcome[] = [];
    for (const id of ids) {
      outcomes.push(
        yield* dispatchShipment({
          organizationId,
          shippingOrderId: String(id),
        }).pipe(
          Effect.as<BulkOutcome>({ id, ok: true }),
          Effect.catch(failure =>
            Effect.succeed<BulkOutcome>({ id, ok: false, code: failure.code }),
          ),
        ),
      );
    }
    return outcomes;
  });
