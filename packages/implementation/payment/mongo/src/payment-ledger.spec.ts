import { isStoreFault } from '@entifix/core';
import {
  COMMAND_INBOX_COLLECTION,
  OUTBOX_COLLECTION,
} from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import {
  Payment,
  PaymentAllocation,
  type PaymentLedger,
  PaymentLedgerTag,
  Refund,
} from '@r10c/business-ts-payment-management';
import { describePaymentLedgerContract } from '@r10c/business-ts-payment-management/testing';
import { mongoCellWorld } from '@r10c/testing-cells/mongo';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ALLOCATION_COLLECTION,
  MongoPaymentLedgerLayer,
  PAYMENT_COLLECTION,
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

const outcome = (paymentId = 'pay-1'): PaymentOutcome => ({
  paymentId,
  groupId: 'group-1',
  allocations: [{ orderId: 'order-1', vendorId: 'vendor-1', amount: 40 }],
  amount: 40,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-10-25T12:00:00.000Z',
});

const aPayment = (id: string, status: Payment['status'] = 'captured') =>
  Object.assign(new Payment('group-1', 40, 'GTQ'), {
    id,
    paymentMethod: 'card',
    status,
  });

const aShare = (id = 'alloc-1', orderId = 'order-1') =>
  Object.assign(new PaymentAllocation(), {
    id,
    paymentId: 'pay-1',
    groupId: 'group-1',
    orderId,
    vendorId: 'vendor-1',
    authorized: 40,
    captured: 40,
    refunded: 0,
    currency: 'GTQ',
  });

const aRefund = (id: string, amount = 10) =>
  Object.assign(new Refund('order-1', 'alloc-1', amount, 'GTQ'), {
    id,
    status: 'pending',
  });

const decided = (refund: Refund, status: Refund['status']) =>
  Object.assign(refund, {
    status,
    providerReference: 'ref',
    decidedAt: new Date(0),
  });

const eventNames = (fake: Fake) =>
  fake
    .read(OUTBOX_COLLECTION)
    .map(entry => (entry['event'] as { name: string }).name);

const captured = (run: ReturnType<typeof world>['run']) =>
  run(ledger =>
    ledger.recordCapture(aPayment('pay-1'), [aShare()], outcome(), undefined),
  );

describe('recording a capture', () => {
  it('writes the payment and its allocations, announces it, and drains it at once', async () => {
    const { fake, bus, run } = world();

    const written = await run(ledger =>
      ledger.recordCapture(aPayment('pay-1'), [aShare()], outcome(), 'cmd-1'),
    );

    expect(written._tag).toBe('recorded');
    expect(fake.read(PAYMENT_COLLECTION)[0]).toMatchObject({
      id: 'pay-1',
      groupId: 'group-1',
      decidedAt: '2026-10-25T12:00:00.000Z',
    });
    expect(fake.read(ALLOCATION_COLLECTION)[0]).toMatchObject({
      id: 'alloc-1',
      orderId: 'order-1',
      captured: 40,
    });
    expect(eventNames(fake)).toEqual(['payment.captured']);
    expect(bus.published.map(event => event.name)).toEqual([
      'payment.captured',
    ]);
  });

  it('records a declined capture, allocates nothing and announces it to nobody', async () => {
    const { fake, run } = world();

    await run(ledger =>
      ledger.recordCapture(
        aPayment('pay-1', 'failed'),
        [aShare()],
        outcome(),
        undefined,
      ),
    );

    expect(fake.read(PAYMENT_COLLECTION)).toHaveLength(1);
    expect(fake.read(ALLOCATION_COLLECTION)).toEqual([]);
    expect(eventNames(fake)).toEqual([]);
  });

  it('refuses a second capture naming an order already paid for', async () => {
    const { fake, run } = world();
    await captured(run);

    const refused = await run(ledger =>
      Effect.flip(
        ledger.recordCapture(
          aPayment('pay-2'),
          [aShare('alloc-2')],
          outcome('pay-2'),
          undefined,
        ),
      ),
    );

    expect(refused).toMatchObject({ code: 'duplicateKey' });
    expect(fake.read(PAYMENT_COLLECTION)).toHaveLength(1);
  });

  it('reports a duplicate that remembers no decision as a failure, never as a replay', async () => {
    const { run } = world({
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
      Effect.flip(
        ledger.recordCapture(aPayment('pay-5'), [aShare()], outcome(), 'cmd-5'),
      ),
    );
    // No command at all: the announcement's id collided with another's.
    const collided = await run(ledger =>
      Effect.flip(
        ledger.recordCapture(
          aPayment('pay-6'),
          [aShare('alloc-6', 'order-6')],
          outcome('pay-6'),
          undefined,
        ),
      ),
    );

    expect(isStoreFault(claimed)).toBe(true);
    expect(isStoreFault(collided)).toBe(true);
  });

  it('remembers what a command decided, and nothing for one never seen', async () => {
    const { run } = world();
    await run(ledger =>
      ledger.recordCapture(aPayment('pay-3'), [aShare()], outcome(), 'cmd-3'),
    );

    const remembered = await run(ledger => ledger.decidedPayment('cmd-3'));
    const none = await run(ledger => ledger.decidedPayment('cmd-9'));

    expect(Option.getOrUndefined(remembered)?.id).toBe('pay-3');
    expect(Option.isNone(none)).toBe(true);
  });

  it('reports a write the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('insertMany', new Error('disk full'));

    const error = await run(ledger =>
      Effect.flip(
        ledger.recordCapture(
          aPayment('pay-1'),
          [aShare()],
          outcome(),
          undefined,
        ),
      ),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});

describe('a refund', () => {
  it('takes its amount off the allocation, then announces it once decided', async () => {
    const { fake, run } = world();
    await captured(run);

    const reserved = await run(ledger =>
      ledger.reserveRefund(aRefund('ref-1', 15), 'r-1'),
    );
    const done = await run(ledger =>
      ledger.decideRefund(decided(aRefund('ref-1', 15), 'refunded'), {
        ...outcome(),
        refundId: 'ref-1',
      }),
    );

    expect(reserved._tag).toBe('reserved');
    expect(done.status).toBe('refunded');
    expect(fake.read(ALLOCATION_COLLECTION)[0]).toMatchObject({ refunded: 15 });
    expect(eventNames(fake)).toEqual(['payment.captured', 'payment.refunded']);
    expect(
      Option.getOrUndefined(await run(ledger => ledger.decidedRefund('r-1')))
        ?.status,
    ).toBe('refunded');
    expect(
      Option.isNone(await run(ledger => ledger.decidedRefund('r-9'))),
    ).toBe(true);
  });

  it('gives a declined refund’s share back and announces nothing', async () => {
    const { fake, run } = world();
    await captured(run);
    await run(ledger => ledger.reserveRefund(aRefund('ref-1', 40), undefined));

    await run(ledger =>
      ledger.decideRefund(decided(aRefund('ref-1', 40), 'failed'), outcome()),
    );
    const again = await run(ledger =>
      ledger.decideRefund(decided(aRefund('ref-1', 40), 'refunded'), outcome()),
    );

    expect(again.status).toBe('failed');
    expect(fake.read(ALLOCATION_COLLECTION)[0]).toMatchObject({ refunded: 0 });
    expect(eventNames(fake)).toEqual(['payment.captured']);
  });

  it('answers a decision on a refund it never reserved with the refund as given', async () => {
    const { fake, run } = world();

    const answer = await run(ledger =>
      ledger.decideRefund(decided(aRefund('ref-x'), 'refunded'), outcome()),
    );

    expect(answer.id).toBe('ref-x');
    expect(eventNames(fake)).toEqual([]);
  });

  it('answers a refund past the capture with what is left', async () => {
    const { run } = world();
    await captured(run);
    await run(ledger => ledger.reserveRefund(aRefund('ref-1', 30), undefined));

    const over = await run(ledger =>
      ledger.reserveRefund(aRefund('ref-2', 11), undefined),
    );
    const orphan = await run(ledger =>
      ledger.reserveRefund(
        Object.assign(aRefund('ref-3'), { allocationId: 'nope' }),
        undefined,
      ),
    );

    expect(over).toEqual({ _tag: 'exceeds', remaining: 10 });
    expect(orphan).toEqual({ _tag: 'exceeds', remaining: 0 });
  });

  it('answers a repeated reservation with the refund as it stands, or as first remembered', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [
        {
          commandId: 'r-ghost',
          claimedAt: 'then',
          replay: {
            record: {
              id: 'ref-ghost',
              orderId: 'order-1',
              allocationId: 'alloc-1',
              amount: 5,
              currency: 'GTQ',
              status: 'pending',
            },
          },
        },
        { commandId: 'r-empty', claimedAt: 'then' },
      ],
    });
    await captured(run);
    await run(ledger => ledger.reserveRefund(aRefund('ref-1', 5), 'r-1'));

    const again = await run(ledger =>
      ledger.reserveRefund(aRefund('ref-2', 5), 'r-1'),
    );
    const ghost = await run(ledger =>
      ledger.reserveRefund(aRefund('ref-3', 5), 'r-ghost'),
    );
    const empty = await run(ledger =>
      Effect.flip(ledger.reserveRefund(aRefund('ref-4', 5), 'r-empty')),
    );

    expect(again).toMatchObject({ _tag: 'replayed', refund: { id: 'ref-1' } });
    expect(ghost).toMatchObject({
      _tag: 'replayed',
      refund: { id: 'ref-ghost' },
    });
    expect(isStoreFault(empty)).toBe(true);
  });

  it('reports a driver failure while reserving or deciding as a store failure', async () => {
    const reserving = world();
    await captured(reserving.run);
    reserving.fake.failOn('updateOne', new Error('network down'));
    const deciding = world();
    await captured(deciding.run);
    await deciding.run(ledger =>
      ledger.reserveRefund(aRefund('ref-1'), undefined),
    );
    deciding.fake.failOn('updateOne', new Error('network down'));

    const reserve = await reserving.run(ledger =>
      Effect.flip(ledger.reserveRefund(aRefund('ref-1'), undefined)),
    );
    const decide = await deciding.run(ledger =>
      Effect.flip(
        ledger.decideRefund(decided(aRefund('ref-1'), 'refunded'), outcome()),
      ),
    );

    expect(isStoreFault(reserve)).toBe(true);
    expect(isStoreFault(decide)).toBe(true);
  });

  it('reports a refund row the driver would not write as a store failure', async () => {
    const { fake, run } = world();
    await captured(run);
    fake.failOn('insertMany', new Error('disk full'));

    const error = await run(ledger =>
      Effect.flip(ledger.reserveRefund(aRefund('ref-1'), undefined)),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});

describe('reads', () => {
  it('finds an order’s allocation, and reports a failed read as a store failure', async () => {
    const { fake, run } = world();
    await captured(run);

    expect(await run(ledger => ledger.allocationFor('order-1'))).toMatchObject({
      id: 'alloc-1',
    });
    expect(
      await run(ledger => ledger.allocationFor('order-9')),
    ).toBeUndefined();

    fake.failOn('findOne', new Error('network down'));
    const error = await run(ledger =>
      Effect.flip(ledger.allocationFor('order-1')),
    );
    expect(isStoreFault(error)).toBe(true);
  });

  it('reports a remembered answer that will not read back as a store failure', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'cmd-x', claimedAt: 'then', replay: { record: 'nope' } },
      ],
    });

    const error = await run(ledger =>
      Effect.flip(ledger.decidedPayment('cmd-x')),
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
