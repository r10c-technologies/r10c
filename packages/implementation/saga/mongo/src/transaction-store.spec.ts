import { EntifixConnError, isStoreFault } from '@entifix/core';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  makeMongoTransactionStore,
  transactionFold,
} from './transaction-store.js';

/**
 * A store failure, as this cell can surface one while the class tree and
 * typed failures coexist: its own wrapper's `EntifixConnError`, or the unit of
 * work's `StoreFault` passed through (ADR 0064).
 */
const storeFailed = (error: unknown): boolean =>
  error instanceof EntifixConnError || isStoreFault(error);

const withCollection = (collection: Record<string, unknown>) =>
  makeMongoTransactionStore({
    collection: () => collection,
  } as unknown as Db);

describe('transactionFold', () => {
  it('sets only the members the event carries', () => {
    const { filter, update } = transactionFold({
      transactionId: 'tx-1',
      entity: 'product-specification',
      state: 'PENDING',
      step: 'accepted',
      at: '2026-01-01T00:00:00.000Z',
    });

    expect(filter).toEqual({ transactionId: 'tx-1' });
    // An `undefined` written into `$set` would overwrite a value a later event
    // had already folded in — the members are absent, not null.
    expect(update.$set).toEqual({
      entity: 'product-specification',
      state: 'PENDING',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(update.$setOnInsert).toEqual({
      transactionId: 'tx-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('carries every optional member the event does have', () => {
    const { update } = transactionFold({
      transactionId: 'tx-2',
      entity: 'product-specification',
      state: 'COMPLETED',
      step: 'completed',
      at: '2026-01-01T00:00:00.000Z',
      organizationId: 'demo-organization',
      code: 'PS-0001',
      entityId: 'tx-2',
      error: 'none',
    });

    expect(update.$set).toMatchObject({
      organizationId: 'demo-organization',
      code: 'PS-0001',
      entityId: 'tx-2',
      error: 'none',
    });
  });
});

describe('makeMongoTransactionStore.countByState', () => {
  it('reports every state, filling the ones the aggregation omits', async () => {
    const counts = await Effect.runPromise(
      withCollection({
        aggregate: () => ({
          toArray: async () => [
            { _id: 'COMPLETED', count: 12 },
            { _id: 'PENDING', count: 3 },
          ],
        }),
      }).countByState(),
    );

    // Mongo returns no row for a state with no records. Passing that straight
    // through would drop the series, and a dropped series reads as "no data"
    // rather than as "none" — so `STALE` at zero would look like a broken
    // exporter.
    expect(counts).toEqual({
      PENDING: 3,
      COMPLETED: 12,
      FAILED: 0,
      STALE: 0,
    });
  });

  it('ignores a state the code does not know', async () => {
    const counts = await Effect.runPromise(
      withCollection({
        aggregate: () => ({
          toArray: async () => [
            { _id: 'COMPLETED', count: 1 },
            { _id: 'ABANDONED', count: 99 },
          ],
        }),
      }).countByState(),
    );

    // A stray value from an older writer must not appear as a fifth series that
    // nothing in the code can explain.
    expect(counts).toEqual({
      PENDING: 0,
      COMPLETED: 1,
      FAILED: 0,
      STALE: 0,
    });
  });

  it('reports a failure rather than an all-zero tally', async () => {
    const outcome = await Effect.runPromise(
      Effect.result(
        withCollection({
          aggregate: () => ({
            toArray: async () => {
              throw new Error('not primary');
            },
          }),
        }).countByState(),
      ),
    );

    // All zeroes would read as "the fleet is idle", which is the opposite of
    // what an unqueryable store means.
    expect(outcome._tag).toBe('Failure');
  });
});

describe('makeMongoTransactionStore over the driver', () => {
  const at = (minutesAgo: number) =>
    new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const event = (
    transactionId: string,
    state: 'PENDING' | 'COMPLETED',
    minutesAgo: number,
  ) =>
    ({
      transactionId,
      entity: 'product-specification',
      state,
      at: at(minutesAgo),
    }) as never;

  it('upserts from an event and reads the record back, and answers undefined for none', async () => {
    const fake = makeFakeMongoDb();
    const store = makeMongoTransactionStore(fake.db as Db);

    const record = await Effect.runPromise(
      store.upsertFromEvent(event('t-1', 'PENDING', 0)),
    );
    const missing = await Effect.runPromise(store.get('t-9'));

    expect(record).toMatchObject({ transactionId: 't-1', state: 'PENDING' });
    expect(missing).toBeUndefined();
  });

  it('finds what has been pending too long, and marks only a pending record stale', async () => {
    const fake = makeFakeMongoDb();
    const store = makeMongoTransactionStore(fake.db as Db);
    for (const one of [
      event('old', 'PENDING', 60),
      event('fresh', 'PENDING', 0),
      event('done', 'COMPLETED', 60),
    ]) {
      await Effect.runPromise(store.upsertFromEvent(one));
    }

    const stale = await Effect.runPromise(store.findStale(30 * 60_000));
    await Effect.runPromise(store.markStale('old'));
    await Effect.runPromise(store.markStale('done'));

    expect(stale.map(one => one.transactionId)).toEqual(['old']);
    expect((await Effect.runPromise(store.get('old')))?.state).toBe('STALE');
    expect((await Effect.runPromise(store.get('done')))?.state).toBe(
      'COMPLETED',
    );
  });

  it('reports every driver failure as a store failure', async () => {
    const cases: [
      string,
      (
        store: ReturnType<typeof makeMongoTransactionStore>,
      ) => Effect.Effect<unknown, unknown>,
    ][] = [
      ['updateOne', store => store.upsertFromEvent(event('t-1', 'PENDING', 0))],
      ['findOne', store => store.upsertFromEvent(event('t-1', 'PENDING', 0))],
      ['findOne', store => store.get('t-1')],
      ['find', store => store.findStale(1)],
      ['updateOne', store => store.markStale('t-1')],
    ];
    for (const [op, act] of cases) {
      const fake = makeFakeMongoDb();
      fake.failOn(op, new Error(`${op} failed`));

      const error = await Effect.runPromise(
        Effect.flip(act(makeMongoTransactionStore(fake.db as Db))),
      );

      expect(storeFailed(error)).toBe(true);
    }
  });
});
