import { Effect, Option } from 'effect';

import type { Payment } from '../entities/payment';
import type { Refund } from '../entities/refund';
import type { PaymentLedger } from '../ports/payment-ledger';

/**
 * A {@link PaymentLedger} held in memory, for the specs of whatever consumes
 * the port. It runs `describePaymentLedgerContract`, so it refunds a capture
 * once and replays a command the way the Mongo ledger does.
 */
export const makeInMemoryPaymentLedger = (): PaymentLedger => {
  const payments: Payment[] = [];
  const refunds: Refund[] = [];
  const decided = new Map<string, Payment | Refund>();

  const firstDecision = <T extends Payment | Refund>(
    commandId: string | undefined,
  ) =>
    commandId === undefined
      ? undefined
      : (decided.get(commandId) as T | undefined);

  const remember = (
    commandId: string | undefined,
    record: Payment | Refund,
  ) => {
    if (commandId !== undefined) decided.set(commandId, record);
  };

  return {
    decidedPayment: commandId =>
      Effect.sync(() => Option.fromUndefinedOr(firstDecision<Payment>(commandId))),
    decidedRefund: commandId =>
      Effect.sync(() => Option.fromUndefinedOr(firstDecision<Refund>(commandId))),
    captureFor: orderId =>
      Effect.sync(() =>
        payments.find(
          payment =>
            payment.orderId === orderId && payment.status === 'captured',
        ),
      ),
    refundFor: paymentId =>
      Effect.sync(() => refunds.find(refund => refund.paymentId === paymentId)),
    recordCapture: (payment, _outcome, commandId) =>
      Effect.sync(() => {
        const first = firstDecision<Payment>(commandId);
        if (first !== undefined) return { _tag: 'replayed', record: first };
        payments.push(payment);
        remember(commandId, payment);
        return { _tag: 'recorded', record: payment };
      }),
    recordRefund: (refund, _outcome, commandId) =>
      Effect.sync(() => {
        const first = firstDecision<Refund>(commandId);
        if (first !== undefined) return { _tag: 'replayed', record: first };
        // A new command meeting a sibling's refund of the same capture: the
        // unique key refuses it, and the refund already made is the answer.
        const sibling = refunds.find(
          made => made.paymentId === refund.paymentId,
        );
        if (sibling !== undefined) return { _tag: 'replayed', record: sibling };
        refunds.push(refund);
        remember(commandId, refund);
        return { _tag: 'recorded', record: refund };
      }),
  };
};
