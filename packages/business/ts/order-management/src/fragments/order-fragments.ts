import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-flow-contracts';
import { BuyerContactSchema } from '@r10c/business-ts-order-contracts';
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
  version: 3,
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
      // The buyer's contact, nested as they gave it; absent at a counter.
      contact: Schema.optional(BuyerContactSchema),
      locale: Schema.optional(Schema.String),
    }),
    output: openStruct({ id: GroupId }),
    failure: participantRefusal(['invalidBody', 'invalid']),
  },
});

/**
 * Write one vendor's order into the group. Compensated by deleting it, which
 * also takes it out of the group.
 */
export const orderWrite = defineFragment({
  id: 'order.write',
  version: 6,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order' },
  compensation: { method: 'DELETE', path: '/api/product-order/:id' },
  cardinality: 'perVendor',
  isolation: 'none',
  consumes: { groupId: GroupId },
  provides: { orderId: OrderId, orderNumber: Schema.String },
  contract: {
    input: openStruct({
      groupId: GroupId,
      vendorId: Schema.NonEmptyString,
      paymentMethod: Schema.NonEmptyString,
      // Each line names what it was sold as, copied from the projection it
      // was priced from and never updated (#582).
      items: Schema.Array(
        openStruct({
          offeringId: Schema.NonEmptyString,
          name: Schema.NonEmptyString,
          // Each line's tax, stated by the coordinator once per document
          // (ADR 0078 §6) and stored as told.
          kind: Schema.NonEmptyString,
          taxTreatment: Schema.NonEmptyString,
          taxRate: Schema.Number,
          taxableBase: Schema.Number,
          taxAmount: Schema.Number,
        }),
      ),
      // The seller's fiscal identity, copied from the published vendor, and
      // the buyer's — consumidor final when they gave none.
      sellerTaxId: Schema.NonEmptyString,
      sellerLegalName: Schema.NonEmptyString,
      sellerTaxRegime: Schema.NonEmptyString,
      sellerEstablishmentCode: Schema.NonEmptyString,
      buyerTaxIdType: Schema.NonEmptyString,
      buyerTaxId: Schema.NonEmptyString,
      buyerTaxName: Schema.String,
      netAmount: Schema.Number,
      taxAmount: Schema.Number,
      totalAmount: Schema.Number,
      currency: Schema.NonEmptyString,
    }),
    output: openStruct({
      id: OrderId,
      status: Schema.String,
      orderId: OrderId,
      orderNumber: Schema.String,
    }),
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

/**
 * A payment-link order's commit point: `pending → awaiting-payment`, stamping
 * when it stops waiting from the window the coordinator states (ADR 0081 §2–3).
 * After the checkout's commit point — a link segment commits like a
 * cash-on-delivery one and *then* waits — so retried.
 */
export const orderAwaitPayment = defineFragment({
  id: 'order.await-payment',
  version: 1,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: {
    method: 'POST',
    path: '/api/product-order/:orderId/awaiting-payment',
  },
  cardinality: 'perVendor',
  isolation: 'reRead',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({
      orderId: OrderId,
      paymentWindowMs: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
    output: ORDER,
    failure: participantRefusal([
      'notFound',
      'orderNotTransitionable',
      'invalidBody',
    ]),
  },
});

/**
 * Wait for the seller's decision on a payment link: answered `confirmed` by
 * `order.payment-confirmed`, or `cancelled` by the `order.cancelled` an expiry
 * or a withdrawal announces. The order's status is the arbiter, so a timeout
 * firing means a signal was lost — a case for a person, and the recipe
 * strands on it. A wait makes no call; the one named reads the order.
 */
export const orderPaymentDecision = defineFragment({
  id: 'order.payment-decision',
  version: 1,
  outcomes: ['confirmed', 'cancelled'],
  module: 'order-management',
  kind: 'wait',
  participant: PARTICIPANT,
  call: { method: 'GET', path: '/api/product-order/:orderId' },
  cardinality: 'perVendor',
  consumes: { orderId: OrderId },
  contract: {
    input: openStruct({ orderId: OrderId }),
    output: ORDER,
    failure: participantRefusal([]),
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

/**
 * Mail a storefront buyer their receipt with a one-time access link — the
 * checkout's last step, after its commit point, so a failure retries rather
 * than compensates (ADR 0076 §6). Each attempt draws a fresh link, and the
 * outcome carries no token: it lands in the journal.
 */
export const orderNotifyBuyer = defineFragment({
  id: 'order.notify-buyer',
  version: 1,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/checkout-group/:groupId/receipt-mail' },
  cardinality: 'one',
  isolation: 'reRead',
  consumes: { groupId: GroupId },
  contract: {
    input: openStruct({ groupId: GroupId }),
    output: openStruct({
      id: GroupId,
      outcome: Schema.Literals(['sent', 'no-contact']),
    }),
    failure: participantRefusal(['notFound']),
  },
});

/** Every fragment order-management contributes. */
export const ORDER_FRAGMENTS = [
  orderOpenGroup,
  orderWrite,
  orderClaimCancel,
  orderConfirm,
  orderAwaitPayment,
  orderPaymentDecision,
  orderMarkDispatched,
  orderClose,
  orderNotifyBuyer,
] as const;
