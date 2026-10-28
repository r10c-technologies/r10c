import type { TransitionalFailure } from '@entifix/core';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Context, type Effect, type Option } from 'effect';

import type { Payment } from '../entities/payment';
import type { Refund } from '../entities/refund';

/**
 * How a ledger write went. `replayed` is not a failure: the record carries
 * what an earlier write — a redelivery of the same command, or a second
 * command aimed at the same capture — already decided, and that is the
 * answer the caller gives.
 */
export type LedgerWrite<T> =
  | { readonly _tag: 'recorded'; readonly record: T }
  | { readonly _tag: 'replayed'; readonly record: T };

/**
 * The `payment` store: captures and refunds, each recorded with its
 * announcement in one transaction, and each idempotent on the command that
 * asked for it.
 *
 * ⚠️ **A decision is recorded even when the provider declined.** The record
 * that an attempt happened is what support and reconciliation both need; the
 * announcement is what differs (`payment.failed`, or nothing for a refused
 * refund).
 */
export interface PaymentLedger {
  /** What a command already decided, if anything did — read before any money moves. */
  readonly decidedPayment: (
    commandId: string,
  ) => Effect.Effect<Option.Option<Payment>, TransitionalFailure>;
  readonly decidedRefund: (
    commandId: string,
  ) => Effect.Effect<Option.Option<Refund>, TransitionalFailure>;
  /** The captured payment behind an order, if there is one. */
  readonly captureFor: (
    orderId: string,
  ) => Effect.Effect<Payment | undefined, TransitionalFailure>;
  /** The refund already made against a capture, if there is one. */
  readonly refundFor: (
    paymentId: string,
  ) => Effect.Effect<Refund | undefined, TransitionalFailure>;
  readonly recordCapture: (
    payment: Payment,
    outcome: PaymentOutcome,
    commandId: string | undefined,
  ) => Effect.Effect<LedgerWrite<Payment>, TransitionalFailure>;
  readonly recordRefund: (
    refund: Refund,
    outcome: PaymentOutcome,
    commandId: string | undefined,
  ) => Effect.Effect<LedgerWrite<Refund>, TransitionalFailure>;
}

export class PaymentLedgerTag extends Context.Service<
  PaymentLedgerTag,
  PaymentLedger
>()('PaymentLedgerTag') {}
