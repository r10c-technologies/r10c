import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { Payment } from '../entities/payment';
import { PaymentAllocation } from '../entities/payment-allocation';
import { Refund } from '../entities/refund';
import type { PaymentLedger } from '../ports/payment-ledger';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const outcome = (paymentId: string): PaymentOutcome => ({
  paymentId,
  groupId: 'group-1',
  allocations: [
    { orderId: 'order-1', vendorId: 'vendor-1', amount: 30 },
    { orderId: 'order-2', vendorId: 'vendor-2', amount: 10 },
  ],
  amount: 40,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-10-25T12:00:00.000Z',
});

const payment = (id: string, status: Payment['status'] = 'captured') =>
  Object.assign(new Payment('group-1', 40, 'GTQ'), {
    id,
    paymentMethod: 'card',
    status,
  });

const allocation = (id: string, orderId: string, amount: number) =>
  Object.assign(new PaymentAllocation(), {
    id,
    paymentId: 'pay-1',
    groupId: 'group-1',
    orderId,
    vendorId: `vendor-${orderId}`,
    authorized: amount,
    captured: amount,
    refunded: 0,
    currency: 'GTQ',
    paymentMethod: 'card',
  });

const shares = () => [
  allocation('alloc-1', 'order-1', 30),
  allocation('alloc-2', 'order-2', 10),
];

const refund = (id: string, amount: number) =>
  Object.assign(new Refund('order-1', 'alloc-1', amount, 'GTQ'), {
    id,
    status: 'pending',
  });

const decided = (refunded: Refund, status: Refund['status']) =>
  Object.assign(refunded, { status, decidedAt: new Date(0) });

/**
 * What every {@link PaymentLedger} must guarantee, through the port alone.
 * - A capture is found by each order it allocated, and only once taken.
 * - A command id answers its redelivery with the first decision.
 * - Partial refunds of one allocation sum to its capture and no further; a
 *   declined refund gives its share back.
 *
 * `make` returns a fresh, empty ledger.
 *
 * Deliberately not asserted: a concurrent burst of refunds against one
 * allocation. That is the guarded `$inc` against a real server (ADR 0063),
 * proved in the live pass; the sequential case it reduces to is below.
 */
export const describePaymentLedgerContract = (
  name: string,
  make: () => PaymentLedger | Promise<PaymentLedger>,
) => {
  describe(`${name} honours the PaymentLedger contract`, () => {
    it('finds each order’s share of a capture, and a command by what it decided', async () => {
      const ledger = await make();

      const written = await run(
        ledger.recordCapture(
          payment('pay-1'),
          shares(),
          outcome('pay-1'),
          'c-1',
        ),
      );

      expect(written).toMatchObject({
        _tag: 'recorded',
        record: { id: 'pay-1' },
      });
      expect(await run(ledger.allocationFor('order-1'))).toMatchObject({
        id: 'alloc-1',
        captured: 30,
        refunded: 0,
      });
      expect(await run(ledger.allocationFor('order-2'))).toMatchObject({
        captured: 10,
      });
      expect(
        Option.getOrUndefined(await run(ledger.decidedPayment('c-1'))),
      ).toMatchObject({ id: 'pay-1', status: 'captured' });
      expect(Option.isNone(await run(ledger.decidedPayment('c-2')))).toBe(true);
    });

    it('records a declined capture without allocating anything', async () => {
      const ledger = await make();

      await run(
        ledger.recordCapture(
          payment('pay-1', 'failed'),
          shares(),
          outcome('pay-1'),
          'c-1',
        ),
      );

      expect(await run(ledger.allocationFor('order-1'))).toBeUndefined();
      expect(
        Option.getOrUndefined(await run(ledger.decidedPayment('c-1')))?.status,
      ).toBe('failed');
    });

    it('answers a redelivered capture with the first decision', async () => {
      const ledger = await make();
      await run(
        ledger.recordCapture(
          payment('pay-1'),
          shares(),
          outcome('pay-1'),
          'c-1',
        ),
      );

      const again = await run(
        ledger.recordCapture(
          payment('pay-2'),
          shares(),
          outcome('pay-2'),
          'c-1',
        ),
      );

      expect(again).toMatchObject({
        _tag: 'replayed',
        record: { id: 'pay-1' },
      });
    });

    it('lets partial refunds sum to the capture, and refuses the one past it', async () => {
      const ledger = await make();
      await run(
        ledger.recordCapture(
          payment('pay-1'),
          shares(),
          outcome('pay-1'),
          undefined,
        ),
      );

      const first = await run(ledger.reserveRefund(refund('r-1', 20), 'rc-1'));
      const second = await run(ledger.reserveRefund(refund('r-2', 10), 'rc-2'));
      const third = await run(ledger.reserveRefund(refund('r-3', 1), 'rc-3'));

      expect(first._tag).toBe('reserved');
      expect(second._tag).toBe('reserved');
      expect(third).toEqual({ _tag: 'exceeds', remaining: 0 });
      expect(await run(ledger.allocationFor('order-1'))).toMatchObject({
        refunded: 30,
      });
      // The other vendor's share is untouched by this order's refunds.
      expect(await run(ledger.allocationFor('order-2'))).toMatchObject({
        refunded: 0,
      });
    });

    it('refuses a refund against an allocation that does not exist', async () => {
      const ledger = await make();

      expect(
        await run(ledger.reserveRefund(refund('r-1', 1), undefined)),
      ).toEqual({ _tag: 'exceeds', remaining: 0 });
    });

    it('answers a repeated refund command with the refund as it stands', async () => {
      const ledger = await make();
      await run(
        ledger.recordCapture(
          payment('pay-1'),
          shares(),
          outcome('pay-1'),
          undefined,
        ),
      );
      await run(ledger.reserveRefund(refund('r-1', 20), 'rc-1'));
      await run(
        ledger.decideRefund(decided(refund('r-1', 20), 'refunded'), {
          ...outcome('pay-1'),
          refundId: 'r-1',
        }),
      );

      const again = await run(ledger.reserveRefund(refund('r-9', 20), 'rc-1'));

      expect(again).toMatchObject({
        _tag: 'replayed',
        refund: { id: 'r-1', status: 'refunded' },
      });
      expect(
        Option.getOrUndefined(await run(ledger.decidedRefund('rc-1'))),
      ).toMatchObject({ id: 'r-1', status: 'refunded' });
      expect(Option.isNone(await run(ledger.decidedRefund('rc-2')))).toBe(true);
      expect(await run(ledger.allocationFor('order-1'))).toMatchObject({
        refunded: 20,
      });
    });

    it('gives a declined refund’s share back, and decides a refund once', async () => {
      const ledger = await make();
      await run(
        ledger.recordCapture(
          payment('pay-1'),
          shares(),
          outcome('pay-1'),
          undefined,
        ),
      );
      await run(ledger.reserveRefund(refund('r-1', 30), undefined));

      const declined = await run(
        ledger.decideRefund(
          decided(refund('r-1', 30), 'failed'),
          outcome('pay-1'),
        ),
      );
      const late = await run(
        ledger.decideRefund(
          decided(refund('r-1', 30), 'refunded'),
          outcome('pay-1'),
        ),
      );

      expect(declined.status).toBe('failed');
      expect(late.status).toBe('failed');
      expect(await run(ledger.allocationFor('order-1'))).toMatchObject({
        refunded: 0,
      });
    });
  });
};
