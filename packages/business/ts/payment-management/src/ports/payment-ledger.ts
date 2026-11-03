import type { StoreFailure } from '@entifix/core';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Context, type Effect, type Option } from 'effect';

import type { Payment } from '../entities/payment';
import type { PaymentAllocation } from '../entities/payment-allocation';
import type { Refund } from '../entities/refund';

/** How a ledger write went: recorded now, or what an earlier command recorded. */
export type LedgerWrite<T> =
  | { readonly _tag: 'recorded'; readonly record: T }
  | { readonly _tag: 'replayed'; readonly record: T };

/**
 * How taking a refund's share went: taken, the one a repeated command took, or
 * refused because less than asked is left of the allocation.
 */
export type RefundReservation =
  | { readonly _tag: 'reserved'; readonly refund: Refund }
  | { readonly _tag: 'replayed'; readonly refund: Refund }
  | { readonly _tag: 'exceeds'; readonly remaining: number };

/**
 * The `payment` store's ledger: every capture, allocation and refund, each
 * recorded with its announcement in one unit and claimed on the command that
 * asked for it.
 *
 * ⚠️ **A refund is two writes around the provider call, and that is the
 * point.** {@link reserveRefund} takes the amount off what is left of the
 * allocation with a guarded `$inc` *before* the provider moves any money, so a
 * burst of refunds against one order can never send back more than was taken;
 * {@link decideRefund} then records what the provider said, announcing a refund
 * that went through and giving the share back for one that did not.
 */
export interface PaymentLedger {
  /** What a command decided about a capture, if it ran before. */
  readonly decidedPayment: (
    commandId: string,
  ) => Effect.Effect<Option.Option<Payment>, StoreFailure>;
  /** The refund a command reserved, as it stands now. */
  readonly decidedRefund: (
    commandId: string,
  ) => Effect.Effect<Option.Option<Refund>, StoreFailure>;
  /** The share of a capture that paid for one order. */
  readonly allocationFor: (
    orderId: string,
  ) => Effect.Effect<PaymentAllocation | undefined, StoreFailure>;
  /**
   * A payment and its allocations, with the announcement when it was taken.
   * A collection is the same write: a `cod` payment with one allocation.
   */
  readonly recordCapture: (
    payment: Payment,
    allocations: readonly PaymentAllocation[],
    outcome: PaymentOutcome,
    commandId: string | undefined,
  ) => Effect.Effect<LedgerWrite<Payment>, StoreFailure>;
  /** Take a refund's amount off its allocation, if that much is left. */
  readonly reserveRefund: (
    refund: Refund,
    commandId: string | undefined,
  ) => Effect.Effect<RefundReservation, StoreFailure>;
  /**
   * Record the provider's answer on a reserved refund: announce it when the
   * money went back, give the share back to the allocation when it did not.
   */
  readonly decideRefund: (
    refund: Refund,
    outcome: PaymentOutcome,
  ) => Effect.Effect<Refund, StoreFailure>;
}

export class PaymentLedgerTag extends Context.Service<
  PaymentLedgerTag,
  PaymentLedger
>()('PaymentLedgerTag') {}
