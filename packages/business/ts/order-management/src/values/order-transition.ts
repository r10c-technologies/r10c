import type { OrderStatus } from './order-status';

/**
 * The moves an order can make once placed.
 *
 * `pending → paid` is not here: it is what consuming `payment.captured`
 * writes, never anywhere a flow or a person drives an order to. What is left
 * is what a checkout, a delivery or a cancellation asks of one vendor's order
 * ([ADR 0069](../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md),
 * [ADR 0070](../../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 *
 * `await-payment`, `confirm-payment` and `end-awaiting-payment` are a
 * payment-link order's: it waits past its checkout's commit point, and exactly
 * one of the seller's confirmation and its ending — the window lapsing, or
 * the buyer withdrawing — wins, because both are one conditional write on
 * `awaiting-payment` (ADR 0081 §4).
 *
 * `claim-cancel` and `settle-cancel` are the two halves of one cancellation,
 * separated because a refund sits between them and cannot be undone; the claim
 * is compensatable, the settle only rolls forward.
 */
export const OrderTransitions = [
  'await-payment',
  'confirm-payment',
  'end-awaiting-payment',
  'confirm',
  'mark-dispatched',
  'close-fulfilled',
  'close-cancelled',
  'claim-cancel',
  'settle-cancel',
] as const;

export type OrderTransition = (typeof OrderTransitions)[number];

/**
 * The status a transition produces, or `undefined` if the move is illegal.
 *
 * A table rather than a chain of `if`s, because it is the whole rule and it
 * belongs where it can be read at a glance and tested without a database.
 *
 * Three entries are worth reading twice.
 *
 * **`confirm` is legal from `pending` and `paid`.** A cash-on-delivery order is
 * confirmed at its checkout's commit point with no money taken; a card order is
 * confirmed once its capture has made it `paid`.
 *
 * **`close-cancelled` is legal from `dispatched` alone.** It is the delivery
 * flow closing a refused or returned parcel; a cancellation before dispatch
 * goes through the claim, and settles out of `cancelling`.
 *
 * **`cancelling → cancelling` is deliberately absent.** The claim is the
 * concurrency guard, so a second claim landing on a record already claimed
 * must fail rather than pass — that refusal *is* the lock.
 */
const TRANSITIONS: Record<
  OrderTransition,
  Partial<Record<OrderStatus, OrderStatus>>
> = {
  'await-payment': { pending: 'awaiting-payment' },
  'confirm-payment': { 'awaiting-payment': 'paid' },
  'end-awaiting-payment': { 'awaiting-payment': 'cancelled' },
  confirm: { pending: 'confirmed', paid: 'confirmed' },
  'mark-dispatched': { confirmed: 'dispatched' },
  'close-fulfilled': { dispatched: 'fulfilled' },
  'close-cancelled': { dispatched: 'cancelled' },
  'claim-cancel': { paid: 'cancelling', confirmed: 'cancelling' },
  'settle-cancel': { cancelling: 'cancelled' },
};

/** The resulting status, or `undefined` when the transition is not allowed. */
export function orderStatusAfter(
  current: OrderStatus,
  transition: OrderTransition,
): OrderStatus | undefined {
  return TRANSITIONS[transition][current];
}

/** Whether a transition is allowed from a given status. */
export function isLegalOrderTransition(
  current: OrderStatus,
  transition: OrderTransition,
): boolean {
  return orderStatusAfter(current, transition) !== undefined;
}

/** The statuses a transition is legal from — what its conditional write matches. */
export function statusesBefore(
  transition: OrderTransition,
): readonly OrderStatus[] {
  return Object.keys(TRANSITIONS[transition]) as OrderStatus[];
}

/** The stamp a flow's move writes beside the status, if it writes one. */
export const MOVE_STAMP_OF: Partial<
  Record<OrderTransition, 'dispatchedAt' | 'fulfilledAt'>
> = {
  'mark-dispatched': 'dispatchedAt',
  'close-fulfilled': 'fulfilledAt',
};
