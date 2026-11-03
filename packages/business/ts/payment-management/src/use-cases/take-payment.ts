import { Failure } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  type PaymentOutcome,
  type PaymentShare,
  RefundDeclined,
} from '@r10c/business-ts-payment-contracts';
import { Effect, Option, Schema } from 'effect';

import { Payment } from '../entities/payment';
import { PaymentAllocation } from '../entities/payment-allocation';
import { Refund } from '../entities/refund';
import {
  CodNotEntitled,
  CodOverLimit,
  RefundExceedsCapture,
} from '../failures/payment-failures';
import { CodAcceptanceTag, CodPolicyTag } from '../ports/cod';
import { PaymentLedgerTag } from '../ports/payment-ledger';
import { PaymentProviderTag } from '../ports/payment-provider';

/**
 * An order with no captured payment, so nothing to send back. A refusal
 * rather than a fault: the coordinator reads it as "this step refused" and
 * compensates the claim before it.
 */
export class NothingToRefund extends Failure.notFound<NothingToRefund>()(
  'NothingToRefund',
  'noCapturedPayment',
  { orderId: Schema.String },
  {
    message: ({ orderId }) =>
      `nothing was captured for order ${orderId}, so nothing can go back`,
  },
) {}

/**
 * The provider refused to take the money. The attempt is still recorded — the
 * record that it happened is what support and reconciliation both need — and
 * a redelivery answers this same refusal, never success.
 */
export class PaymentDeclined extends Failure.declined<PaymentDeclined>()(
  'PaymentDeclined',
  'paymentDeclined',
  { paymentId: Schema.String, reason: Schema.optionalKey(Schema.String) },
  { message: ({ reason }) => reason ?? 'the payment was not captured' },
) {}

/** How taking money went. `replayed` answers what an earlier attempt decided. */
export type CaptureResult =
  | { readonly _tag: 'captured'; readonly payment: Payment }
  | { readonly _tag: 'replayed'; readonly payment: Payment };

/** How sending money back went. */
export type RefundResult =
  | { readonly _tag: 'refunded'; readonly refund: Refund }
  | { readonly _tag: 'replayed'; readonly refund: Refund };

/** One vendor order's share of a capture, as a caller asks for it. */
export type RequestedShare = PaymentShare;

const declinedPayment = (payment: Payment, reason: string | undefined) =>
  new PaymentDeclined({
    paymentId: String(payment.id),
    ...(reason === undefined ? {} : { reason }),
  });

const declinedRefund = (refund: Refund, reason: string | undefined) =>
  new RefundDeclined({
    orderId: refund.orderId,
    ...(reason === undefined ? {} : { reason }),
  });

/**
 * Why a set of shares cannot split a payment, or `undefined` when it can:
 * at least one share, every share positive, no order twice, and the shares
 * summing to exactly the amount charged.
 */
export const sharesProblem = (
  amount: number,
  shares: readonly RequestedShare[],
): string | undefined => {
  if (amount <= 0) return 'a payment must carry a positive amount';
  if (shares.length === 0) return 'a payment must pay for at least one order';
  if (shares.some(share => share.amount <= 0)) {
    return 'every order share must be positive';
  }
  if (new Set(shares.map(share => share.orderId)).size !== shares.length) {
    return 'an order may be paid for once per payment';
  }
  const total = shares.reduce((sum, share) => sum + share.amount, 0);
  return total === amount
    ? undefined
    : 'the order shares must sum to the amount charged';
};

/** The allocation rows a payment's shares become. */
const allocationsOf = (payment: Payment, shares: readonly RequestedShare[]) =>
  shares.map(share =>
    Object.assign(new PaymentAllocation(), {
      id: globalThis.crypto.randomUUID(),
      paymentId: String(payment.id),
      groupId: payment.groupId,
      orderId: share.orderId,
      vendorId: share.vendorId,
      authorized: share.amount,
      captured: payment.status === 'captured' ? share.amount : 0,
      refunded: 0,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
    }),
  );

/** The announcement a decided payment carries. */
const outcomeOf = (
  payment: Payment,
  shares: readonly RequestedShare[],
  provider: { providerReference?: string; failureReason?: string },
): PaymentOutcome => ({
  paymentId: String(payment.id),
  groupId: payment.groupId,
  allocations: shares,
  amount: payment.amount,
  currency: payment.currency,
  paymentMethod: payment.paymentMethod,
  decidedAt: new Date().toISOString(),
  channelId: payment.channelId,
  providerReference: provider.providerReference,
  failureReason: provider.failureReason,
});

/**
 * Take the money for a checkout group — the checkout's **pivot**, the one
 * write in the fleet that cannot be compensated — and split it into one
 * allocation per vendor order.
 *
 * ⚠️ **A redelivered command must not charge twice**, and is answered with what
 * the first delivery decided, status and all: telling the coordinator a
 * declined capture succeeded would roll a flow forward past a payment that
 * never happened. So the command's earlier decision is read **before** the
 * provider is called, and the ledger's command claim is the backstop for two
 * deliveries racing past that read.
 */
export const capturePayment = (input: {
  readonly payment: Payment;
  readonly shares: readonly RequestedShare[];
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { payment, shares, commandId } = input;
    const problem = sharesProblem(payment.amount, shares);
    if (problem !== undefined) {
      // A payment for nothing would settle to nothing and convert a
      // reservation for free, so it is refused where it is cheapest.
      return yield* new InvalidBody({ reason: problem });
    }

    const ledger = yield* PaymentLedgerTag;
    if (commandId !== undefined) {
      const earlier = yield* ledger.decidedPayment(commandId);
      if (Option.isSome(earlier)) {
        return earlier.value.status === 'captured'
          ? ({ _tag: 'replayed', payment: earlier.value } as CaptureResult)
          : yield* declinedPayment(earlier.value, undefined);
      }
    }

    const provider = yield* PaymentProviderTag;
    payment.id = globalThis.crypto.randomUUID();
    payment.status = 'pending';
    const outcome = yield* provider.capture({
      paymentId: String(payment.id),
      reference: payment.groupId,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
    });
    payment.status = outcome.status;
    payment.providerReference = outcome.providerReference;

    const written = yield* ledger.recordCapture(
      payment,
      allocationsOf(payment, shares),
      outcomeOf(payment, shares, outcome),
      commandId,
    );
    if (written.record.status !== 'captured')
      return yield* declinedPayment(
        written.record,
        written._tag === 'replayed' ? undefined : outcome.failureReason,
      );
    return {
      _tag: written._tag === 'replayed' ? 'replayed' : 'captured',
      payment: written.record,
    } as CaptureResult;
  });

/**
 * Record the cash a courier collected for one cash-on-delivery order: a `cod`
 * payment for that order alone, captured the moment it is recorded, and
 * announced as `payment.captured` like any other — so the order is paid and
 * settlement folds it the same way, flagged as cash the vendor holds.
 *
 * Idempotent on its command: a repeated report of one collection answers the
 * first.
 */
export const recordCollection = (input: {
  readonly groupId: string;
  readonly share: RequestedShare;
  readonly currency: string;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { share, commandId } = input;
    const payment = Object.assign(
      new Payment(input.groupId, share.amount, input.currency),
      { paymentMethod: 'cod' as const },
    );
    const problem = sharesProblem(payment.amount, [share]);
    if (problem !== undefined)
      return yield* new InvalidBody({ reason: problem });

    const ledger = yield* PaymentLedgerTag;
    if (commandId !== undefined) {
      const earlier = yield* ledger.decidedPayment(commandId);
      if (Option.isSome(earlier)) {
        return { _tag: 'replayed', payment: earlier.value } as CaptureResult;
      }
    }

    payment.id = globalThis.crypto.randomUUID();
    payment.status = 'captured';
    const written = yield* ledger.recordCapture(
      payment,
      allocationsOf(payment, [share]),
      outcomeOf(payment, [share], {}),
      commandId,
    );
    return {
      _tag: written._tag === 'replayed' ? 'replayed' : 'captured',
      payment: written.record,
    } as CaptureResult;
  });

/**
 * Send money back for one vendor order — the cancellation's pivot — either all
 * of what is left of its allocation or the part asked for.
 *
 * ⚠️ **Addressed by the order, never by a payment.** A cancellation holds an
 * order and has never seen a payment, and the share it refunds from is
 * resolved here, so a caller cannot aim a refund at money taken for another.
 *
 * ⚠️ **The amount is taken off the allocation before the provider is called**,
 * by a guarded `$inc`, so a burst of refunds against one order can never send
 * back more than was taken — at the provider or in the ledger. A refund the
 * provider declines gives its share back.
 */
export const refundPayment = (input: {
  readonly orderId: string;
  readonly amount?: number | undefined;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { orderId, commandId } = input;
    const ledger = yield* PaymentLedgerTag;

    if (commandId !== undefined) {
      const earlier = yield* ledger.decidedRefund(commandId);
      if (Option.isSome(earlier)) {
        return earlier.value.status === 'refunded'
          ? ({ _tag: 'replayed', refund: earlier.value } as RefundResult)
          : yield* declinedRefund(earlier.value, undefined);
      }
    }

    const allocation = yield* ledger.allocationFor(orderId);
    if (allocation === undefined || allocation.captured <= 0) {
      return yield* new NothingToRefund({ orderId });
    }
    const remaining = allocation.captured - allocation.refunded;
    const amount = input.amount ?? remaining;
    if (amount <= 0 || amount > remaining) {
      return yield* new RefundExceedsCapture({
        orderId,
        requested: amount,
        remaining,
      });
    }

    const refund = Object.assign(
      new Refund(orderId, String(allocation.id), amount, allocation.currency),
      {
        id: globalThis.crypto.randomUUID(),
        status: 'pending' as Refund['status'],
      },
    );
    const reservation = yield* ledger.reserveRefund(refund, commandId);
    if (reservation._tag === 'exceeds') {
      return yield* new RefundExceedsCapture({
        orderId,
        requested: amount,
        remaining: reservation.remaining,
      });
    }
    if (reservation._tag === 'replayed') {
      return reservation.refund.status === 'refunded'
        ? ({ _tag: 'replayed', refund: reservation.refund } as RefundResult)
        : yield* declinedRefund(reservation.refund, undefined);
    }

    const provider = yield* PaymentProviderTag;
    const outcome = yield* provider.refund({
      // Our id for *this* attempt, which a real adapter sends as the provider's
      // idempotency key — deliberately not the capture's, which would make the
      // refund and the charge one idempotent operation at the far end.
      paymentId: String(refund.id),
      reference: orderId,
      amount,
      currency: allocation.currency,
      paymentMethod: allocation.paymentMethod,
    });
    const decidedAt = new Date();
    refund.status = outcome.status === 'refunded' ? 'refunded' : 'failed';
    refund.providerReference = outcome.providerReference;
    refund.decidedAt = decidedAt;

    const decided = yield* ledger.decideRefund(refund, {
      // The payment being given back from — what a reconciliation pairs, and
      // what the deduplication key is built from.
      paymentId: allocation.paymentId,
      groupId: allocation.groupId,
      allocations: [
        { orderId, vendorId: allocation.vendorId, amount: refund.amount },
      ],
      amount: refund.amount,
      currency: allocation.currency,
      paymentMethod: allocation.paymentMethod,
      decidedAt: decidedAt.toISOString(),
      providerReference: outcome.providerReference,
      failureReason: outcome.failureReason,
      refundId: String(refund.id),
    });
    if (decided.status !== 'refunded')
      return yield* declinedRefund(decided, outcome.failureReason);
    return { _tag: 'refunded', refund: decided } as RefundResult;
  });

/**
 * May this seller's order be paid cash on delivery? Refused when the fleet has
 * switched cash on delivery off, when the seller does not ship it, or when the
 * order is worth more than a courier is trusted to carry. A read, and nothing
 * else: a slip runs it before the commit point and has nothing to undo.
 */
export const checkCodEligibility = (input: {
  readonly vendorId: string;
  readonly amount: number;
}) =>
  Effect.gen(function* () {
    const policy = yield* CodPolicyTag;
    if (!policy.enabled) {
      return yield* new CodNotEntitled({ vendorId: input.vendorId });
    }
    if (input.amount > policy.maxAmount) {
      return yield* new CodOverLimit({
        vendorId: input.vendorId,
        amount: input.amount,
        limit: policy.maxAmount,
      });
    }
    const acceptance = yield* CodAcceptanceTag;
    if (!(yield* acceptance.acceptsCod(input.vendorId))) {
      return yield* new CodNotEntitled({ vendorId: input.vendorId });
    }
    return { vendorId: input.vendorId, eligible: true as const };
  });
