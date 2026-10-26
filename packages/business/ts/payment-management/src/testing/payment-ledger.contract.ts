import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { Payment } from '../entities/payment';
import { Refund } from '../entities/refund';
import type { PaymentLedger } from '../ports/payment-ledger';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const outcome = (paymentId: string, orderId: string): PaymentOutcome => ({
  paymentId,
  orderId,
  amount: 40,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-10-25T12:00:00.000Z',
});

const payment = (
  id: string,
  orderId: string,
  status: Payment['status'] = 'captured',
) =>
  Object.assign(new Payment(orderId, 40, 'GTQ'), {
    id,
    paymentMethod: 'card',
    status,
  });

const refund = (
  id: string,
  paymentId: string,
  status: Refund['status'] = 'refunded',
) => Object.assign(new Refund('order-1', paymentId, 40, 'GTQ'), { id, status });

/**
 * What every {@link PaymentLedger} must guarantee, through the port alone: a
 * capture is found by its order only once it was taken, a command id answers
 * its redelivery with the first decision, and a capture is refunded at most
 * once — by a redelivery of one command or by a second command alike.
 *
 * `make` returns a fresh, empty ledger.
 *
 * Deliberately not asserted: two concurrent refund commands for one capture
 * leaving one row. That is the unique index against a real server (ADR 0063);
 * the sequential case it reduces to is asserted below.
 */
export const describePaymentLedgerContract = (
  name: string,
  make: () => PaymentLedger | Promise<PaymentLedger>,
) => {
  describe(`${name} honours the PaymentLedger contract`, () => {
    it('finds a capture by its order, and a command by what it decided', async () => {
      const ledger = await make();

      const written = await run(
        ledger.recordCapture(
          payment('pay-1', 'order-1'),
          outcome('pay-1', 'order-1'),
          'c-1',
        ),
      );
      const found = await run(ledger.captureFor('order-1'));
      const decided = await run(ledger.decidedPayment('c-1'));

      expect(written).toMatchObject({
        _tag: 'recorded',
        record: { id: 'pay-1' },
      });
      expect(found).toMatchObject({ id: 'pay-1', status: 'captured' });
      expect(Option.getOrThrow(decided)).toMatchObject({ id: 'pay-1' });
    });

    it('records a declined capture, which is not a capture of its order', async () => {
      const ledger = await make();

      const written = await run(
        ledger.recordCapture(
          payment('pay-1', 'order-1', 'failed'),
          outcome('pay-1', 'order-1'),
          undefined,
        ),
      );

      expect(written._tag).toBe('recorded');
      expect(await run(ledger.captureFor('order-1'))).toBeUndefined();
    });

    it('answers a redelivered capture with what its command first decided', async () => {
      const ledger = await make();
      await run(
        ledger.recordCapture(
          payment('pay-1', 'order-1'),
          outcome('pay-1', 'order-1'),
          'c-1',
        ),
      );

      const again = await run(
        ledger.recordCapture(
          payment('pay-2', 'order-1'),
          outcome('pay-2', 'order-1'),
          'c-1',
        ),
      );

      expect(again).toMatchObject({
        _tag: 'replayed',
        record: { id: 'pay-1' },
      });
      expect(await run(ledger.captureFor('order-1'))).toMatchObject({
        id: 'pay-1',
      });
    });

    it('knows nothing it was never told', async () => {
      const ledger = await make();

      expect(Option.isNone(await run(ledger.decidedPayment('nope')))).toBe(
        true,
      );
      expect(Option.isNone(await run(ledger.decidedRefund('nope')))).toBe(
        true,
      );
      expect(await run(ledger.captureFor('nope'))).toBeUndefined();
      expect(await run(ledger.refundFor('nope'))).toBeUndefined();
    });

    it('refunds a capture once per command, and finds the refund by its capture', async () => {
      const ledger = await make();

      const written = await run(
        ledger.recordRefund(
          refund('ref-1', 'pay-1'),
          outcome('pay-1', 'order-1'),
          'k-1',
        ),
      );
      const again = await run(
        ledger.recordRefund(
          refund('ref-2', 'pay-1'),
          outcome('pay-1', 'order-1'),
          'k-1',
        ),
      );

      expect(written).toMatchObject({
        _tag: 'recorded',
        record: { id: 'ref-1' },
      });
      expect(again).toMatchObject({
        _tag: 'replayed',
        record: { id: 'ref-1' },
      });
      expect(await run(ledger.refundFor('pay-1'))).toMatchObject({
        id: 'ref-1',
      });
      expect(
        Option.getOrThrow(await run(ledger.decidedRefund('k-1'))),
      ).toMatchObject({ id: 'ref-1' });
    });

    it('answers a second command refunding the same capture with the refund already made', async () => {
      const ledger = await make();
      await run(
        ledger.recordRefund(
          refund('ref-1', 'pay-1'),
          outcome('pay-1', 'order-1'),
          'k-1',
        ),
      );

      const sibling = await run(
        ledger.recordRefund(
          refund('ref-2', 'pay-1'),
          outcome('pay-1', 'order-1'),
          'k-2',
        ),
      );

      expect(sibling).toMatchObject({
        _tag: 'replayed',
        record: { id: 'ref-1' },
      });
    });

    it('records a refused refund as well', async () => {
      const ledger = await make();

      const written = await run(
        ledger.recordRefund(
          refund('ref-1', 'pay-1', 'failed'),
          outcome('pay-1', 'order-1'),
          undefined,
        ),
      );

      expect(written).toMatchObject({
        _tag: 'recorded',
        record: { status: 'failed' },
      });
    });
  });
};
