import { EntifixConnError, serializeEntity } from '@entifix/core';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  Agreement,
  type SaleHalf,
  type SaleJoin,
  SaleJoinTag,
  type SettlementRunStore,
  SettlementRunStoreTag,
} from '@r10c/business-ts-settlement-management';
import {
  CONTRACT_AGREEMENTS,
  describeSettlementStoreContract,
} from '@r10c/business-ts-settlement-management/testing';
import { mongoCellWorld } from '@r10c/testing-cells/mongo';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_COLLECTION,
  COMMISSION_ENTRY_COLLECTION,
  MongoSettlementStoreLayer,
  SETTLEMENT_RUN_COLLECTION,
  VENDOR_PAYOUT_COLLECTION,
} from './settlement-store.js';

const world = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const cell = mongoCellWorld(MongoSettlementStoreLayer, {
    source: 'settlement',
    seed,
  });
  const { fake, bus } = cell;
  const run = <A, E>(
    use: (ports: {
      join: SaleJoin;
      runs: SettlementRunStore;
    }) => Effect.Effect<A, E>,
  ) =>
    cell.run(
      Effect.gen(function* () {
        return yield* use({
          join: yield* SaleJoinTag,
          runs: yield* SettlementRunStoreTag,
        });
      }),
    );
  let next = 0;
  const contribute = (
    orderId: string,
    half: SaleHalf,
    eventId = `e-${(next += 1)}`,
  ) =>
    run(({ join }) =>
      join.contribute({ consumer: 'settlement.spec', eventId }, orderId, half),
    );
  return { fake, bus, run, contribute };
};

const priced: SaleHalf = {
  commissions: [
    { vendorId: 'v-1', saleAmount: 100, commissionAmount: 10, currency: 'GTQ' },
    { vendorId: 'v-2', saleAmount: 50, commissionAmount: 5, currency: 'GTQ' },
  ],
  unpriced: [],
};
const captured: SaleHalf = { decidedAt: '2026-10-25T12:00:00.000Z' };
const cancelled: SaleHalf = { cancelledAt: '2026-10-26T00:00:00.000Z' };
const refunded: SaleHalf = { refundedAt: '2026-10-26T01:00:00.000Z' };

const entriesOf = (fake: ReturnType<typeof makeFakeMongoDb>, kind: string) =>
  fake
    .read(COMMISSION_ENTRY_COLLECTION)
    .filter(entry => entry['kind'] === kind);

describeSettlementStoreContract('the Mongo store', () =>
  world({
    [AGREEMENT_COLLECTION]: CONTRACT_AGREEMENTS.map(agreement => ({
      ...serializeEntity(Agreement, agreement),
      id: agreement.id,
    })),
  }).run(ports => Effect.succeed(ports)),
);

describe('the sale join', () => {
  it('holds a priced order until its capture arrives, then writes one entry per vendor', async () => {
    const { fake, contribute } = world();

    const first = await contribute('o-1', priced);
    const second = await contribute('o-1', captured);

    expect(first).toEqual({ kind: 'waiting' });
    expect(second).toEqual({ kind: 'written', folded: 2, reversed: 0 });
    expect(entriesOf(fake, 'sale').map(entry => entry['vendorId'])).toEqual([
      'v-1',
      'v-2',
    ]);
  });

  it('folds in either order, and a redelivered message folds nothing twice', async () => {
    const { fake, contribute } = world();

    await contribute('o-2', captured, 'cap-1');
    await contribute('o-2', priced, 'placed-1');
    const again = await contribute('o-2', captured, 'cap-1');

    expect(again).toEqual({ kind: 'duplicate' });
    expect(entriesOf(fake, 'sale')).toHaveLength(2);
  });

  it('reverses a sale once both its cancellation and its refund arrive, mirroring the ledger', async () => {
    const { fake, contribute } = world();
    await contribute('o-3', priced);
    await contribute('o-3', captured);

    const half = await contribute('o-3', cancelled);
    const whole = await contribute('o-3', refunded);

    expect(half).toEqual({ kind: 'waiting' });
    expect(whole).toEqual({ kind: 'written', folded: 0, reversed: 2 });
    expect(
      entriesOf(fake, 'reversal').map(entry => entry['saleAmount']),
    ).toEqual([-100, -50]);
  });

  it('never reverses ahead of the sale, and writes both together when the sale completes last', async () => {
    const { fake, contribute } = world();
    await contribute('o-4', priced);
    await contribute('o-4', cancelled);
    await contribute('o-4', refunded);

    const completed = await contribute('o-4', captured);

    expect(completed).toEqual({ kind: 'written', folded: 2, reversed: 2 });
    expect(entriesOf(fake, 'reversal')).toHaveLength(2);
  });

  it('writes nothing for a sale no vendor could be priced for', async () => {
    const { fake, contribute } = world();
    await contribute('o-5', { commissions: [], unpriced: ['v-9'] });
    const sale = await contribute('o-5', captured);
    await contribute('o-5', cancelled);
    const reversal = await contribute('o-5', refunded);

    expect(sale).toEqual({ kind: 'waiting' });
    expect(reversal).toEqual({ kind: 'waiting' });
    expect(fake.read(COMMISSION_ENTRY_COLLECTION)).toEqual([]);
  });

  it('reports a join the driver failed as a store failure', async () => {
    const { fake, contribute } = world();
    fake.failOn('findOneAndUpdate', new Error('network down'));

    await expect(contribute('o-6', priced)).rejects.toThrow();
  });
});

describe('agreementsFor', () => {
  it('answers each vendor’s newest agreement', async () => {
    const { run } = world({
      [AGREEMENT_COLLECTION]: [
        {
          id: 'a-old',
          vendorId: 'v-1',
          commissionBasisPoints: 500,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          id: 'a-new',
          vendorId: 'v-1',
          commissionBasisPoints: 800,
          effectiveFrom: new Date('2026-06-01'),
        },
      ],
    });

    const agreements = await run(({ join }) =>
      join.agreementsFor(['v-1', 'v-2']),
    );

    expect(agreements.get('v-1')?.commissionBasisPoints).toBe(800);
    expect(agreements.has('v-2')).toBe(false);
  });
});

describe('settleOnce', () => {
  it('is idle with nothing unsettled', async () => {
    const { run } = world();

    expect(await run(({ runs }) => runs.settleOnce())).toEqual({
      kind: 'idle',
    });
  });

  it('settles every unsettled line into a payout per vendor, records the run, and announces it at once', async () => {
    const { fake, bus, contribute, run } = world();
    await contribute('o-7', priced);
    await contribute('o-7', captured);

    const outcome = await run(({ runs }) => runs.settleOnce());

    expect(outcome).toMatchObject({
      kind: 'calculated',
      payouts: 2,
      entries: 2,
    });
    expect(
      fake.read(VENDOR_PAYOUT_COLLECTION).map(payout => payout['amount']),
    ).toEqual([90, 45]);
    expect(fake.read(SETTLEMENT_RUN_COLLECTION)[0]?.['status']).toBe(
      'calculated',
    );
    expect(bus.published.map(event => event.name)).toEqual([
      'settlement.run.completed',
    ]);
  });

  it('records an empty attempt when a sibling sweep took the lines first', async () => {
    const { fake, run } = world({
      [COMMISSION_ENTRY_COLLECTION]: [
        // Unsettled, but stamped after this pass's period ends.
        {
          id: 'e-late',
          orderId: 'o',
          vendorId: 'v-1',
          kind: 'sale',
          saleAmount: 1,
          commissionAmount: 0,
          currency: 'GTQ',
          occurredAt: new Date(Date.now() + 3_600_000),
        },
      ],
    });

    const outcome = await run(({ runs }) => runs.settleOnce());

    expect(outcome).toEqual({ kind: 'idle' });
    expect(fake.read(SETTLEMENT_RUN_COLLECTION)[0]?.['status']).toBe(
      'cancelled',
    );
  });

  it('reports a pass the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('find', new Error('network down'));

    const error = await run(({ runs }) => Effect.flip(runs.settleOnce()));

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('MongoSettlementStoreLayer', () => {
  it('fails to build when its indexes cannot be ensured', async () => {
    const { fake, run } = world();
    fake.failOn('createIndex', new Error('not primary'));

    await expect(run(() => Effect.void)).rejects.toThrow();
  });

  it('reports an agreement that will not read back', async () => {
    const { fake, run } = world({
      [AGREEMENT_COLLECTION]: [
        {
          id: 'a',
          vendorId: 'v-1',
          commissionBasisPoints: 1,
          effectiveFrom: new Date(),
        },
      ],
    });
    fake.failOn('find', new Error('cursor died'));

    const error = await run(({ join }) =>
      Effect.flip(join.agreementsFor(['v-1'])),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});
