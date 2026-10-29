import { isStoreFault } from '@entifix/core';
import {
  COMMAND_INBOX_COLLECTION,
  OUTBOX_COLLECTION,
} from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import {
  Payment,
  type PaymentLedger,
  PaymentLedgerTag,
  Refund,
} from '@r10c/business-ts-payment-management';
import { describePaymentLedgerContract } from '@r10c/business-ts-payment-management/testing';
import { mongoCellWorld } from '@r10c/testing-cells/mongo';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  MongoPaymentLedgerLayer,
  PAYMENT_COLLECTION,
  REFUND_COLLECTION,
} from './payment-ledger.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const world = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const cell = mongoCellWorld(MongoPaymentLedgerLayer, {
    source: 'payment',
    seed,
  });
  const run = <A, E>(use: (ledger: PaymentLedger) => Effect.Effect<A, E>) =>
    cell.run(Effect.flatMap(PaymentLedgerTag, use));
  return { fake: cell.fake, bus: cell.bus, run };
};

describePaymentLedgerContract('the Mongo ledger', () =>
  world().run(ledger => Effect.succeed(ledger)),
);

const outcome = (orderId = 'order-1'): PaymentOutcome => ({
  paymentId: 'pay-1',
  orderId,
  amount: 40,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-10-25T12:00:00.000Z',
});

const aPayment = (id: string, status: Payment['status'] = 'captured') =>
  Object.assign(new Payment(), {
    id,
    orderId: 'order-1',
    amount: 40,
    currency: 'GTQ',
    paymentMethod: 'card',
    status,
  });

const aRefund = (id: string, status: Refund['status'] = 'refunded') =>
  Object.assign(new Refund('order-1', 'pay-1', 40, 'GTQ'), { id, status });

const eventNames = (fake: Fake) =>
  fake
    .read(OUTBOX_COLLECTION)
    .map(entry => (entry['event'] as { name: string }).name);

describe('recording a capture', () => {
  it('writes the payment with its decision time, announces it, and drains it at once', async () => {
    const { fake, bus, run } = world();

    const written = await run(ledger =>
      ledger.recordCapture(aPayment('pay-1'), outcome(), 'cmd-1'),
    );

    expect(written._tag).toBe('recorded');
    expect(fake.read(PAYMENT_COLLECTION)[0]).toMatchObject({
      id: 'pay-1',
      decidedAt: '2026-10-25T12:00:00.000Z',
    });
    expect(eventNames(fake)).toEqual(['payment.captured']);
    // The inline drain: published now, not at the next sweep.
    expect(bus.published.map(event => event.name)).toEqual([
      'payment.captured',
    ]);
  });

  it('records a declined capture and announces it to nobody', async () => {
    const { fake, run } = world();

    await run(ledger =>
      ledger.recordCapture(aPayment('pay-2', 'failed'), outcome(), undefined),
    );

    expect(eventNames(fake)).toEqual([]);
  });

  it('answers a redelivered command with what it first decided', async () => {
    const { fake, run } = world();
    await run(ledger =>
      ledger.recordCapture(aPayment('pay-3'), outcome(), 'cmd-3'),
    );

    const again = await run(ledger =>
      ledger.recordCapture(aPayment('pay-4'), outcome(), 'cmd-3'),
    );
    const remembered = await run(ledger => ledger.decidedPayment('cmd-3'));

    expect(again).toMatchObject({ _tag: 'replayed', record: { id: 'pay-3' } });
    expect(Option.getOrUndefined(remembered)?.id).toBe('pay-3');
    expect(fake.read(PAYMENT_COLLECTION)).toHaveLength(1);
  });

  it('reports a duplicate that remembers no decision as a failure, never as a replay', async () => {
    const { fake, run } = world({
      [COMMAND_INBOX_COLLECTION]: [{ commandId: 'cmd-5', claimedAt: 'then' }],
      [OUTBOX_COLLECTION]: [
        {
          eventId: 'pay-6:2026-10-25T12:00:00.000Z',
          sent: true,
          attempts: 0,
          quarantined: false,
          createdAt: 'then',
        },
      ],
    });

    const claimed = await run(ledger =>
      Effect.flip(ledger.recordCapture(aPayment('pay-5'), outcome(), 'cmd-5')),
    );
    const collided = await run(ledger =>
      Effect.flip(
        ledger.recordCapture(
          aPayment('pay-6'),
          { ...outcome(), paymentId: 'pay-6' },
          undefined,
        ),
      ),
    );

    expect(isStoreFault(claimed)).toBe(true);
    expect(isStoreFault(collided)).toBe(true);
    expect(fake.read(PAYMENT_COLLECTION)).toEqual([]);
  });

  it('remembers nothing for a command never seen', async () => {
    const { run } = world();

    expect(await run(ledger => ledger.decidedPayment('cmd-unknown'))).toEqual(
      Option.none(),
    );
  });
});

describe('reading the store', () => {
  it('finds the captured payment behind an order, and the refund against a capture', async () => {
    const { run } = world({
      [PAYMENT_COLLECTION]: [
        {
          id: 'pay-1',
          orderId: 'order-1',
          status: 'captured',
          amount: 40,
          currency: 'GTQ',
          paymentMethod: 'card',
        },
      ],
      [REFUND_COLLECTION]: [
        {
          id: 'ref-1',
          orderId: 'order-1',
          paymentId: 'pay-1',
          amount: 40,
          currency: 'GTQ',
          status: 'refunded',
        },
      ],
    });

    const capture = await run(ledger => ledger.captureFor('order-1'));
    const refund = await run(ledger => ledger.refundFor('pay-1'));
    const none = await run(ledger => ledger.captureFor('order-unpaid'));

    expect(capture?.id).toBe('pay-1');
    expect(refund?.id).toBe('ref-1');
    expect(none).toBeUndefined();
  });

  it('reports a read the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('findOne', new Error('network down'));

    const error = await run(ledger =>
      Effect.flip(ledger.captureFor('order-1')),
    );

    expect(isStoreFault(error)).toBe(true);
  });

  it('reports a remembered answer that will not read back as a store failure', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [
        {
          commandId: 'cmd-bad',
          claimedAt: 'then',
          replay: { record: 'not a record' },
        },
      ],
    });

    const error = await run(ledger =>
      Effect.flip(ledger.decidedPayment('cmd-bad')),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});

describe('recording a refund', () => {
  it('writes the refund and announces it, and announces a refused one to nobody', async () => {
    const { fake, run } = world();

    await run(ledger =>
      ledger.recordRefund(aRefund('ref-1'), outcome(), 'r-1'),
    );
    await run(ledger =>
      ledger.recordRefund(
        Object.assign(new Refund('order-2', 'pay-2', 40, 'GTQ'), {
          id: 'ref-2',
          status: 'failed',
        }),
        outcome('order-2'),
        undefined,
      ),
    );

    expect(fake.read(REFUND_COLLECTION)).toHaveLength(2);
    expect(eventNames(fake)).toEqual(['payment.refunded']);
  });

  it('answers a redelivered command with its first refund, and a remembered-nothing claim with its own', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [{ commandId: 'r-empty', claimedAt: 'then' }],
    });
    await run(ledger =>
      ledger.recordRefund(aRefund('ref-3'), outcome(), 'r-3'),
    );

    const again = await run(ledger =>
      ledger.recordRefund(aRefund('ref-4'), outcome('order-9'), 'r-3'),
    );
    const empty = await run(ledger =>
      Effect.flip(
        ledger.recordRefund(aRefund('ref-5'), outcome('order-8'), 'r-empty'),
      ),
    );

    expect(again).toMatchObject({ _tag: 'replayed', record: { id: 'ref-3' } });
    expect(
      Option.getOrUndefined(await run(ledger => ledger.decidedRefund('r-3')))
        ?.id,
    ).toBe('ref-3');
    expect(isStoreFault(empty)).toBe(true);
  });

  it('answers a second command aimed at the same capture with the sibling’s refund', async () => {
    const { run } = world({
      [REFUND_COLLECTION]: [
        {
          id: 'ref-sibling',
          orderId: 'order-1',
          paymentId: 'pay-1',
          amount: 40,
          currency: 'GTQ',
          status: 'refunded',
        },
      ],
    });

    const raced = await run(ledger =>
      ledger.recordRefund(aRefund('ref-6'), outcome(), 'r-6'),
    );

    expect(raced).toMatchObject({
      _tag: 'replayed',
      record: { id: 'ref-sibling' },
    });
  });

  it('answers a race whose sibling cannot be read back with its own refund', async () => {
    const { fake, run } = world();
    fake.failOnce(
      'insertOne',
      Object.assign(new Error('E11000'), { code: 11000 }),
    );

    const raced = await run(ledger =>
      ledger.recordRefund(aRefund('ref-7'), outcome(), undefined),
    );

    expect(raced).toMatchObject({ _tag: 'replayed', record: { id: 'ref-7' } });
  });

  it('reports a write the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('insertOne', new Error('disk full'));

    const error = await run(ledger =>
      Effect.flip(ledger.recordRefund(aRefund('ref-8'), outcome(), undefined)),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});

describe('MongoPaymentLedgerLayer', () => {
  it('fails to build when its indexes cannot be ensured', async () => {
    const { fake, run } = world();
    fake.failOn('createIndex', new Error('not primary'));

    await expect(run(() => Effect.void)).rejects.toThrow();
  });
});
