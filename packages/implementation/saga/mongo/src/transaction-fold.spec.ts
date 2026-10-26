import { EntifixConnError } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { INBOX_COLLECTION } from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  type TransactionEvent,
  TransactionStoreTag,
} from '@entifix/transactions';
import { TransactionFoldTag } from '@r10c/business-ts-saga-contracts';
import { describeTransactionFoldContract } from '@r10c/business-ts-saga-contracts/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { mongoTransactionFoldLayer } from './transaction-fold.js';
import { mongoTransactionStoreLayer } from './transaction-store.js';

const event = (
  state: TransactionEvent['state'],
  at = '2026-10-25T10:00:00.000Z',
): TransactionEvent =>
  ({
    transactionId: 't-1',
    entity: 'product-specification',
    state,
    at,
  }) as TransactionEvent;

/** One fake as both client and database: `client.db(name)` answers it. */
const world = () => {
  const fake = makeFakeMongoDb();
  const db = fake.db;
  const client = {
    db: () => db,
    startSession: (...args: unknown[]) =>
      (fake.startSession as (...a: unknown[]) => unknown)(...args),
  };
  const layer = Layer.mergeAll(
    mongoTransactionFoldLayer({ database: 'transaction_manager' }),
    mongoTransactionStoreLayer({ database: 'transaction_manager' }),
  ).pipe(Layer.provide(Layer.succeed(MongoClientTag, client as never)));
  const run = <A, E>(
    effect: Effect.Effect<A, E, TransactionFoldTag | TransactionStoreTag>,
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const fold = (consumer: string, eventId: string, folded: TransactionEvent) =>
    run(
      Effect.flatMap(TransactionFoldTag, tracker =>
        tracker.fold(consumer, eventId, folded),
      ),
    );
  return { fake, run, fold };
};

describeTransactionFoldContract('the Mongo fold', async () => {
  const { run } = world();
  const [fold, store] = await run(
    Effect.all([TransactionFoldTag, TransactionStoreTag]),
  );
  return {
    fold,
    recordOf: transactionId => Effect.runPromise(store.get(transactionId)),
  };
});

describe('folding a transaction event', () => {
  it('claims and folds a first delivery, and folds a redelivery not at all', async () => {
    const w = world();

    const first = await w.fold('tracker', 'e-1', event('PENDING'));
    const again = await w.fold('tracker', 'e-1', event('PENDING'));
    const record = await w.run(
      Effect.flatMap(TransactionStoreTag, store => store.get('t-1')),
    );

    expect([first, again]).toEqual(['claimed', 'duplicate']);
    expect(record).toMatchObject({ transactionId: 't-1', state: 'PENDING' });
  });

  it('claims each step of one transaction separately, and each consumer its own', async () => {
    const w = world();

    await w.fold('tracker', 'e-1', event('PENDING'));
    const completed = await w.fold(
      'tracker',
      'e-2',
      event('COMPLETED', '2026-10-25T10:00:01.000Z'),
    );
    const other = await w.fold('auditor', 'e-1', event('PENDING'));

    expect([completed, other]).toEqual(['claimed', 'claimed']);
    expect(w.fake.read(INBOX_COLLECTION)).toHaveLength(3);
  });

  it('surfaces a write the driver failed as a store failure', async () => {
    const w = world();
    w.fake.failOn('updateOne', new Error('network down'));

    const error = await w.run(
      Effect.flip(
        Effect.flatMap(TransactionFoldTag, tracker =>
          tracker.fold('tracker', 'e-1', event('PENDING')),
        ),
      ),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('the tracker store layer', () => {
  it('fails to build when its index cannot be ensured', async () => {
    const w = world();
    w.fake.failOn('createIndex', new Error('not primary'));

    await expect(
      w.run(Effect.flatMap(TransactionStoreTag, store => store.get('t-1'))),
    ).rejects.toThrow();
  });
});
