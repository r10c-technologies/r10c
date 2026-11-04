import { deserializeSingleEntity, serializeEntity } from '@entifix/core';
import { Effect, Option } from 'effect';

import { Payment } from '../entities/payment';
import { PaymentAllocation } from '../entities/payment-allocation';
import { Refund } from '../entities/refund';
import type { PaymentLedger } from '../ports/payment-ledger';

/**
 * A {@link PaymentLedger} held in memory, for the specs of whatever consumes
 * the port. It runs `describePaymentLedgerContract`, so it never refunds an
 * allocation past what it captured and replays a command the way the Mongo
 * ledger does.
 */
export const makeInMemoryPaymentLedger = (): PaymentLedger => {
  const payments = new Map<string, Payment>();
  const allocations = new Map<string, PaymentAllocation>();
  const refunds = new Map<string, Refund>();
  const decidedPayments = new Map<string, string>();
  const decidedRefunds = new Map<string, string>();

  /** A stored copy, through the same serialization a real store applies. */
  const copy = <T extends Payment | PaymentAllocation | Refund>(
    entity: new () => T,
    record: T,
  ) =>
    Effect.runSync(
      deserializeSingleEntity(entity as never, {
        ...serializeEntity(entity as never, record),
        id: record.id,
      }),
    ) as T;

  const byOrder = (orderId: string) =>
    Array.from(allocations.values()).find(
      allocation => allocation.orderId === orderId,
    );

  return {
    decidedPayment: commandId =>
      Effect.sync(() => {
        const id = decidedPayments.get(commandId);
        const payment = id === undefined ? undefined : payments.get(id);
        return Option.fromUndefinedOr(
          payment === undefined ? undefined : copy(Payment, payment),
        );
      }),
    decidedRefund: commandId =>
      Effect.sync(() => {
        const id = decidedRefunds.get(commandId);
        const refund = id === undefined ? undefined : refunds.get(id);
        return Option.fromUndefinedOr(
          refund === undefined ? undefined : copy(Refund, refund),
        );
      }),
    allocationFor: orderId =>
      Effect.sync(() => {
        const allocation = byOrder(orderId);
        return allocation === undefined
          ? undefined
          : copy(PaymentAllocation, allocation);
      }),
    recordCapture: (payment, shares, _outcome, commandId) =>
      Effect.sync(() => {
        const first =
          commandId === undefined ? undefined : decidedPayments.get(commandId);
        if (first !== undefined) {
          return {
            _tag: 'replayed' as const,
            record: copy(Payment, payments.get(first) as Payment),
          };
        }
        payments.set(String(payment.id), copy(Payment, payment));
        if (payment.status === 'captured') {
          for (const share of shares) {
            allocations.set(String(share.id), copy(PaymentAllocation, share));
          }
        }
        if (commandId !== undefined) {
          decidedPayments.set(commandId, String(payment.id));
        }
        return { _tag: 'recorded' as const, record: copy(Payment, payment) };
      }),
    reserveRefund: (refund, commandId) =>
      Effect.sync(() => {
        const first =
          commandId === undefined ? undefined : decidedRefunds.get(commandId);
        if (first !== undefined) {
          return {
            _tag: 'replayed' as const,
            refund: copy(Refund, refunds.get(first) as Refund),
          };
        }
        const allocation = allocations.get(refund.allocationId);
        const remaining =
          allocation === undefined
            ? 0
            : allocation.captured - allocation.refunded;
        if (allocation === undefined || refund.amount > remaining) {
          return { _tag: 'exceeds' as const, remaining };
        }
        allocation.refunded += refund.amount;
        refunds.set(String(refund.id), copy(Refund, refund));
        if (commandId !== undefined) {
          decidedRefunds.set(commandId, String(refund.id));
        }
        return { _tag: 'reserved' as const, refund: copy(Refund, refund) };
      }),
    decideRefund: refund =>
      Effect.sync(() => {
        const stored = refunds.get(String(refund.id)) as Refund;
        if (stored.status === 'pending') {
          stored.status = refund.status;
          stored.providerReference = refund.providerReference;
          stored.decidedAt = refund.decidedAt;
          if (refund.status !== 'refunded') {
            // A reserved refund always names an allocation the reserve found.
            const allocation = allocations.get(
              refund.allocationId,
            ) as PaymentAllocation;
            allocation.refunded -= refund.amount;
          }
        }
        return copy(Refund, stored);
      }),
  };
};
