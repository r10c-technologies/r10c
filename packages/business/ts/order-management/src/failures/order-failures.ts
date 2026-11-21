import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The code a participant answers when an order is past cancelling — named
 * because the cancellation flow's fragment reads it off a refusal.
 */
export const ORDER_NOT_CANCELLABLE = 'orderNotCancellable';

/**
 * An order a flow refuses because of where it stands: no longer `paid` or
 * `confirmed`, or already claimed by another cancellation. "Never", not "not yet" — compare
 * {@link PaymentPending}.
 */
export class OrderNotCancellable extends Failure.conflict<OrderNotCancellable>()(
  'OrderNotCancellable',
  ORDER_NOT_CANCELLABLE,
  { orderId: Schema.String, reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/**
 * A move the order's status does not allow: confirming an order already
 * dispatched, closing one that never left. A conflict with the record as it
 * stands, never a malformed request.
 */
export class OrderNotTransitionable extends Failure.conflict<OrderNotTransitionable>()(
  'OrderNotTransitionable',
  'orderNotTransitionable',
  {
    orderId: Schema.String,
    standing: Schema.String,
    transition: Schema.String,
  },
  {
    message: ({ standing, transition }) =>
      `an order in '${standing}' cannot ${transition}`,
  },
) {}

/**
 * A buyer cancelling before `payment.captured` has turned the order `paid`.
 * Kept apart from {@link OrderNotCancellable} because the two ask for opposite
 * things: this one is "not yet", and telling a buyer it failed would tell them
 * to stop trying.
 */
export class PaymentPending extends Failure.conflict<PaymentPending>()(
  'PaymentPending',
  'paymentPending',
  { orderId: Schema.String },
  { message: () => 'the payment is still being confirmed' },
) {}

/**
 * Every way a buyer's capability can fail, answered alike and carrying
 * nothing: saying which part was wrong would teach a caller how to forge the
 * rest.
 */
export class CancelNotAuthorized extends Failure.unauthenticated<CancelNotAuthorized>()(
  'CancelNotAuthorized',
  'cancelNotAuthorized',
  {},
  { message: () => 'the order cannot be cancelled from here' },
) {}

/**
 * A payment-link move on an order no longer waiting for its payment: the
 * window lapsed and expired it, the buyer withdrew it, or it was confirmed
 * already. A confirmation that lost to an expiry is refused with this, and the
 * money the buyer paid goes back through the seller's acquirer — the platform
 * never held it (ADR 0081 §4).
 */
export class OrderNotAwaitingPayment extends Failure.conflict<OrderNotAwaitingPayment>()(
  'OrderNotAwaitingPayment',
  'orderNotAwaitingPayment',
  { orderId: Schema.String, standing: Schema.String },
  {
    message: ({ standing }) =>
      `an order in '${standing}' is not waiting for its payment`,
  },
) {}

/**
 * A payment link or confirmation the order cannot carry: a link that is not
 * `https`, too long, from a provider nobody configured or from a host its
 * provider does not serve links from; a confirmation with no authorization
 * number (ADR 0081 §10). `field` names which member, for the form to point at.
 */
export class InvalidPaymentDetails extends Failure.invalid<InvalidPaymentDetails>()(
  'InvalidPaymentDetails',
  'invalidPaymentDetails',
  { field: Schema.String, reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/**
 * A payment receipt whose bytes are not a JPEG, PNG, WebP or PDF — whatever
 * type it was declared as. SVG and HTML are refused because a browser can
 * execute them (ADR 0081 §7).
 */
export class EvidenceTypeRefused extends Failure.invalid<EvidenceTypeRefused>()(
  'EvidenceTypeRefused',
  'evidenceTypeRefused',
  {},
  { message: () => 'a receipt is a JPEG, PNG, WebP or PDF file' },
) {}

/** A payment receipt larger than `order / evidenceMaxBytes` (ADR 0081 §7). */
export class EvidenceTooLarge extends Failure.invalid<EvidenceTooLarge>()(
  'EvidenceTooLarge',
  'evidenceTooLarge',
  { maxBytes: Schema.Number },
  { message: ({ maxBytes }) => `a receipt is at most ${maxBytes} bytes` },
) {}

/**
 * An order that already holds `order / evidenceMaxCount` receipts: the count
 * and the size bound what one capability can do to its own order, in place of
 * a rate limit (ADR 0081 §7).
 */
export class EvidenceLimitReached extends Failure.declined<EvidenceLimitReached>()(
  'EvidenceLimitReached',
  'evidenceLimitReached',
  { maxCount: Schema.Number },
  {
    message: ({ maxCount }) => `an order holds at most ${maxCount} receipts`,
  },
) {}
