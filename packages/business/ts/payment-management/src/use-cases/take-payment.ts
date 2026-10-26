import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Effect, Option } from 'effect';

import type { Payment } from '../entities/payment';
import { Refund } from '../entities/refund';
import { PaymentLedgerTag } from '../ports/payment-ledger';
import { PaymentProviderTag } from '../ports/payment-provider';

/** A capture or refund the domain refuses before any money moves. */
export class PaymentRefused {
  readonly _tag = 'PaymentRefused';
  constructor(
    readonly code: 'invalidBody' | 'noCapturedPayment',
    readonly detail: string,
  ) {}
}

/** How taking money went. `replayed` answers what an earlier attempt decided. */
export type CaptureResult =
  | { readonly _tag: 'captured'; readonly payment: Payment }
  | {
      readonly _tag: 'declined';
      readonly payment: Payment;
      readonly reason: string | undefined;
    }
  | { readonly _tag: 'replayed'; readonly payment: Payment };

/** How sending money back went. */
export type RefundResult =
  | { readonly _tag: 'refunded'; readonly refund: Refund }
  | {
      readonly _tag: 'declined';
      readonly refund: Refund;
      readonly reason: string | undefined;
    }
  | { readonly _tag: 'replayed'; readonly refund: Refund };

/**
 * Take the money for an order — the checkout saga's **pivot**, the one write
 * in the fleet that cannot be compensated.
 *
 * ⚠️ **A redelivered command must not charge twice**, and is answered with what
 * the first delivery decided, status and all: telling the coordinator a
 * declined capture succeeded would roll a saga forward past a payment that
 * never happened. So the command's earlier decision is read **before** the
 * provider is called, and the ledger's command claim is the backstop for two
 * deliveries racing past that read.
 *
 * The payment id is minted here, per attempt, which is exactly why a capture
 * cannot be naturally idempotent and needs the command id at all.
 */
export const capturePayment = (input: {
  readonly payment: Payment;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { payment, commandId } = input;
    if (payment.amount <= 0) {
      // A payment for nothing would settle to nothing and convert a
      // reservation for free, so it is refused where it is cheapest.
      return yield* Effect.fail(
        new PaymentRefused(
          'invalidBody',
          'a payment must carry a positive amount',
        ),
      );
    }

    const ledger = yield* PaymentLedgerTag;
    if (commandId !== undefined) {
      const earlier = yield* ledger.decidedPayment(commandId);
      if (Option.isSome(earlier)) {
        return { _tag: 'replayed', payment: earlier.value } as CaptureResult;
      }
    }

    const provider = yield* PaymentProviderTag;
    payment.id = globalThis.crypto.randomUUID();
    payment.status = 'pending';
    const outcome = yield* provider.capture({
      paymentId: String(payment.id),
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
    });
    payment.status = outcome.status;
    payment.providerReference = outcome.providerReference;

    const announcement: PaymentOutcome = {
      paymentId: String(payment.id),
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
      decidedAt: new Date().toISOString(),
      channelId: payment.channelId,
      providerReference: outcome.providerReference,
      failureReason: outcome.failureReason,
    };

    const written = yield* ledger.recordCapture(
      payment,
      announcement,
      commandId,
    );
    if (written._tag === 'replayed') {
      return { _tag: 'replayed', payment: written.record } as CaptureResult;
    }
    return (
      outcome.status === 'captured'
        ? { _tag: 'captured', payment: written.record }
        : {
            _tag: 'declined',
            payment: written.record,
            reason: outcome.failureReason,
          }
    ) as CaptureResult;
  });

/**
 * Send the money back for an order — the cancellation saga's pivot.
 *
 * ⚠️ **Addressed by the order, never by a payment**, and **the amount is the
 * capture's**: the saga holds an order and has never seen a payment, and a
 * body that could name its own amount could refund more than was charged.
 *
 * ⚠️ **Two guards against refunding twice, answering different questions.**
 * The command id covers a redelivery of one command; one refund per capture
 * covers two different commands aimed at it. Both are read before the
 * provider is called, so neither case moves money at the provider before the
 * ledger refuses to record it.
 */
export const refundPayment = (input: {
  readonly orderId: string;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { orderId, commandId } = input;
    const ledger = yield* PaymentLedgerTag;

    if (commandId !== undefined) {
      const earlier = yield* ledger.decidedRefund(commandId);
      if (Option.isSome(earlier)) {
        return { _tag: 'replayed', refund: earlier.value } as RefundResult;
      }
    }

    const capture = yield* ledger.captureFor(orderId);
    if (capture === undefined) {
      // A business refusal rather than a fault: an order nobody paid for has
      // nothing to send back, and the coordinator reads a 4xx as "this step
      // refused" and compensates the claim before it.
      return yield* Effect.fail(
        new PaymentRefused(
          'noCapturedPayment',
          'nothing was captured for this order, so nothing can go back',
        ),
      );
    }

    const existing = yield* ledger.refundFor(String(capture.id));
    if (existing !== undefined) {
      return { _tag: 'replayed', refund: existing } as RefundResult;
    }

    const provider = yield* PaymentProviderTag;
    const refund = new Refund(
      orderId,
      String(capture.id),
      capture.amount,
      capture.currency,
    );
    refund.id = globalThis.crypto.randomUUID();
    refund.status = 'pending';

    const outcome = yield* provider.refund({
      // Our id for *this* attempt, which a real adapter sends as the provider's
      // idempotency key — deliberately not the capture's, which would make the
      // refund and the charge one idempotent operation at the far end.
      paymentId: String(refund.id),
      orderId,
      amount: capture.amount,
      currency: capture.currency,
      paymentMethod: capture.paymentMethod,
      // The capture's reference is what a real provider refunds *against*.
      providerReference: capture.providerReference,
    });
    const decidedAt = new Date();
    refund.status = outcome.status === 'refunded' ? 'refunded' : 'failed';
    refund.providerReference = outcome.providerReference;
    refund.decidedAt = decidedAt;

    const announcement: PaymentOutcome = {
      // The capture being reversed — what a reconciliation pairs, and what the
      // deduplication key is built from.
      paymentId: String(capture.id),
      orderId,
      amount: capture.amount,
      currency: capture.currency,
      paymentMethod: capture.paymentMethod,
      decidedAt: decidedAt.toISOString(),
      providerReference: outcome.providerReference,
      failureReason: outcome.failureReason,
      refundId: String(refund.id),
    };

    const written = yield* ledger.recordRefund(refund, announcement, commandId);
    if (written._tag === 'replayed') {
      return { _tag: 'replayed', refund: written.record } as RefundResult;
    }
    return (
      outcome.status === 'refunded'
        ? { _tag: 'refunded', refund: written.record }
        : {
            _tag: 'declined',
            refund: written.record,
            reason: outcome.failureReason,
          }
    ) as RefundResult;
  });
