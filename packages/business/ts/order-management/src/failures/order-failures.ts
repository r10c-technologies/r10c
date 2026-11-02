import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The code a participant answers when an order is past cancelling — named
 * because the cancellation saga's fragment reads it off a refusal.
 */
export const ORDER_NOT_CANCELLABLE = 'orderNotCancellable';

/**
 * An order a flow refuses because of where it stands: no longer `paid`, or
 * already claimed by another cancellation. "Never", not "not yet" — compare
 * {@link PaymentPending}.
 */
export class OrderNotCancellable extends Failure.conflict<OrderNotCancellable>()(
  'OrderNotCancellable',
  ORDER_NOT_CANCELLABLE,
  { orderId: Schema.String, reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/** An order that is not `paid`, or changed while its lines were stamped. */
export class OrderNotFulfillable extends Failure.conflict<OrderNotFulfillable>()(
  'OrderNotFulfillable',
  'orderNotFulfillable',
  { orderId: Schema.String, reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/**
 * A vendor cancelling a basket that also names somebody else. The money was
 * taken once, for the whole basket, on one capture — so there is no share of
 * it that is theirs to send back, and no moment at which this succeeds.
 */
export class MultiVendorOrder extends Failure.conflict<MultiVendorOrder>()(
  'MultiVendorOrder',
  'multiVendorOrder',
  { orderId: Schema.String },
  { message: () => 'a vendor cannot cancel an order that names another' },
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
