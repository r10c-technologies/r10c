import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { Effect } from 'effect';

import { ProductOrder } from '../../entities/product-order';
import {
  InvalidPaymentDetails,
  OrderNotAwaitingPayment,
} from '../../failures/order-failures';
import { statusesBefore } from '../../values/order-transition';
import {
  PaymentConfirmationPayload,
  PaymentLinkPayload,
} from '../../values/payment-link';

/** Refused unless the order still waits for its payment. */
const awaitingOnly = (
  order: Pick<ProductOrder, 'id' | 'status'>,
): Effect.Effect<void, OrderNotAwaitingPayment> =>
  order.status === 'awaiting-payment'
    ? Effect.void
    : Effect.fail(
        new OrderNotAwaitingPayment({
          orderId: String(order.id),
          standing: order.status,
        }),
      );

/**
 * The seller confirms that a payment-link order was paid, with the acquirer's
 * authorization number (ADR 0081 §4).
 *
 * **A verb on the order, not in payment-service**: the race it must win or lose
 * is the order's — one conditional write on `awaiting-payment`, against the
 * expiry's — and a vendor's session can be narrowed to an order but not to a
 * `Payment`, which names no vendor. Granted to the vendor's `user` as well as
 * `admin`, as `sell` is: confirming at the counter is staff work.
 *
 * Answers the order, `paid`: the decision is made at that write, and the
 * checkout flow that waited on it carries on by the event it announces.
 */
@useCase({
  entity: ProductOrder,
  key: 'confirm-payment',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-order.useCases.confirmPayment',
  availableWhen: { member: 'status', in: statusesBefore('confirm-payment') },
  payload: PaymentConfirmationPayload,
  errors: [NotFound, OrderNotAwaitingPayment, InvalidPaymentDetails],
})
export class ConfirmPaymentUC {
  static run(
    order: Pick<ProductOrder, 'id' | 'status'>,
  ): Effect.Effect<void, OrderNotAwaitingPayment> {
    return awaitingOnly(order);
  }
}

/** The permission {@link ConfirmPaymentUC} derives. */
export const CONFIRM_PAYMENT = permissionForUseCase(ConfirmPaymentUC);

/**
 * The seller pastes the payment link the buyer pays by — generated with their
 * own acquirer's remote-payment product — and the buyer finds it on their
 * order (ADR 0081 §10). Legal while the order waits, and repeatable: the last
 * link set wins, and who set it and when are kept.
 */
@useCase({
  entity: ProductOrder,
  key: 'set-payment-link',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-order.useCases.setPaymentLink',
  availableWhen: { member: 'status', in: statusesBefore('confirm-payment') },
  payload: PaymentLinkPayload,
  errors: [NotFound, OrderNotAwaitingPayment, InvalidPaymentDetails],
})
export class SetPaymentLinkUC {
  static run(
    order: Pick<ProductOrder, 'id' | 'status'>,
  ): Effect.Effect<void, OrderNotAwaitingPayment> {
    return awaitingOnly(order);
  }
}

/** The permission {@link SetPaymentLinkUC} derives. */
export const SET_PAYMENT_LINK = permissionForUseCase(SetPaymentLinkUC);
