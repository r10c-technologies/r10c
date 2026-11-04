import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-flow-contracts';
import { Schema } from 'effect';

import { ORDER_NOT_CANCELLABLE } from '../failures/order-failures';

/** The participant every order fragment calls. */
const PARTICIPANT = 'order-service';

/**
 * An order's id, provided by its write — or, in a flow on an order that
 * already exists, stated by its start input. Every path that addresses an
 * order names it `:orderId`, the key a step is given it under.
 */
const OrderId = Schema.String;

/** A checkout group's id — the flow's own — provided by its opening. */
const GroupId = Schema.String;

const ORDER = openStruct({ id: OrderId, status: Schema.String });

/** The refusal every crossing move on a placed order can answer. */
const MOVE_REFUSAL = participantRefusal(['notFound', 'orderNotTransitionable']);

/**
 * Open the buyer's checkout group under the flow's id, before any vendor's
 * order. Compensated by deleting it (ADR 0069). The body is the group's own
 * members, flat, as every flow step's is.
 */
export const orderOpenGroup = defineFragment({
  id: 'order.open-group',
  version: 2,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/checkout-group' },
  compensation: { method: 'DELETE', path: '/api/checkout-group/:id' },
  cardinality: 'one',
  isolation: 'none',
  provides: { groupId: GroupId },
  contract: {
    input: openStruct({
      id: Schema.NonEmptyString,
      totals: Schema.Array(Schema.Unknown),
      cancelDigest: Schema.optional(Schema.String),
    }),
    output: openStruct({ id: GroupId }),
    failure: participantRefusal(['invalidBody']),
  },
});

/**
 * Write one vendor's order into the group. Compensated by deleting it, which
 * also takes it out of the group.
 */
export const orderWrite = defineFragment({
  id: 'order.write',
  version: 3,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order' },
  compensation: { method: 'DELETE', path: '/api/product-order/:id' },
  cardinality: 'perVendor',
  isolation: 'none',
  consumes: { groupId: GroupId },
  provides: { orderId: OrderId },
  contract: {
    input: openStruct({
      groupId: GroupId,
      vendorId: Schema.NonEmptyString,
      paymentMethod: Schema.NonEmptyString,
      items: Schema.Array(Schema.Unknown),
    }),
    output: ORDER,
    failure: participantRefusal(['invalidBody', 'notFound']),
  },
});

/**
 * Claim a `paid` or `confirmed` order for cancellation. The claim is a semantic
 * lock: while it is held, a dispatch and a second cancellation see
 * `cancelling` and back off (ADR 0058). Compensated by releasing it back to
 * the status it was claimed from.
 */
export const orderClaimCancel = defineFragment({
  id: 'order.claim-cancel',
  version: 3,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:orderId/cancelling' },
  compensation: {
    method: 'DELETE',
    path: '/api/product-order/:orderId/cancelling',
  },
  cardinality: 'one',
  isolation: 'semanticLock',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({ orderId: OrderId }),
    output: ORDER,
    failure: participantRefusal(['notFound', ORDER_NOT_CANCELLABLE]),
  },
});

/**
 * Confirm a vendor order once its checkout commits — after the capture for a
 * card order, at `flow.commit` for cash on delivery. After the commit point, so
 * retried.
 */
export const orderConfirm = defineFragment({
  id: 'order.confirm',
  version: 2,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:orderId/confirmed' },
  cardinality: 'perVendor',
  isolation: 'reRead',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({ orderId: OrderId }),
    output: ORDER,
    failure: MOVE_REFUSAL,
  },
});

/** Mark a vendor order dispatched, once its shipment left. Retried. */
export const orderMarkDispatched = defineFragment({
  id: 'order.mark-dispatched',
  version: 2,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:orderId/dispatched' },
  cardinality: 'one',
  isolation: 'reRead',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({ orderId: OrderId }),
    output: ORDER,
    failure: MOVE_REFUSAL,
  },
});

/**
 * Close a vendor order: `fulfilled` on delivery, `cancelled` for a parcel
 * refused or returned, or a cancellation's claim settled. After the pivot of
 * whichever flow runs it, so retried; it re-reads the order rather than
 * trusting what an earlier step saw.
 */
export const orderClose = defineFragment({
  id: 'order.close',
  version: 2,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:orderId/closed' },
  cardinality: 'one',
  isolation: 'reRead',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({
      orderId: OrderId,
      outcome: Schema.Literals(['fulfilled', 'cancelled']),
    }),
    output: ORDER,
    failure: MOVE_REFUSAL,
  },
});

/** Every fragment order-management contributes. */
export const ORDER_FRAGMENTS = [
  orderOpenGroup,
  orderWrite,
  orderClaimCancel,
  orderConfirm,
  orderMarkDispatched,
  orderClose,
] as const;
