import type {
  TransactionEvent,
  TransactionRecord,
  TransactionStore,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, HashMap, Logger } from 'effect';
import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { foldClaimed, sweepStale } from './tracking';

const STALE_TIMEOUT_MS = 60_000;

const aRecord = (transactionId: string): TransactionRecord => ({
  transactionId,
  entity: 'product-specification',
  state: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  organizationId: 'demo-organization',
});

/**
 * A store that records what the sweep did to it. `findStale` returns the same
 * batch every call — one pass is what a spec asserts on.
 */
const recordingStore = (stale: readonly TransactionRecord[]) => {
  const marked: string[] = [];

  const store: TransactionStore = {
    upsertFromEvent: () => Effect.die('not used'),
    get: () => Effect.succeed(undefined),
    findStale: () => Effect.succeed(stale),
    markStale: transactionId =>
      Effect.sync(() => {
        marked.push(transactionId);
      }),
    countByState: () =>
      Effect.succeed({
        PENDING: stale.length,
        COMPLETED: 0,
        FAILED: 0,
        STALE: 0,
      }),
  };

  return { store, marked };
};

/** A store whose `findStale` cannot run — the case that used to vanish. */
const failingStore = (message: string): TransactionStore => ({
  upsertFromEvent: () => Effect.die('not used'),
  get: () => Effect.succeed(undefined),
  findStale: () => Effect.fail(new EntifixConnError(message)),
  markStale: () => Effect.void,
  countByState: () => Effect.fail(new EntifixConnError(message)),
});

/** Runs one sweep and returns the log records it emitted. */
const runSweep = async (store: TransactionStore) => {
  const logs: Array<{
    message: string;
    level: string;
    annotations: Record<string, unknown>;
  }> = [];

  await Effect.runPromise(
    sweepStale(store, STALE_TIMEOUT_MS).pipe(
      Effect.provide(
        Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ logLevel, message, annotations }) => {
            logs.push({
              message: String(message),
              level: logLevel.label,
              annotations: Object.fromEntries(HashMap.toEntries(annotations)),
            });
          }),
        ),
      ),
    ),
  );

  return logs;
};

describe('sweepStale', () => {
  it('marks every stale record and says nothing when the pass succeeds', async () => {
    const { store, marked } = recordingStore([
      aRecord('tx-1'),
      aRecord('tx-2'),
    ]);

    const logs = await runSweep(store);

    expect(marked).toEqual(['tx-1', 'tx-2']);
    expect(logs).toEqual([]);
  });

  it('is a no-op on an empty sweep', async () => {
    const { store, marked } = recordingStore([]);

    const logs = await runSweep(store);

    expect(marked).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('reports a failed pass instead of swallowing it', async () => {
    // The regression this guards: the handler was `() => Effect.void`, so a
    // sweep that could not query produced no record anywhere and recovery
    // silently stopped happening while the daemon went on looping.
    const logs = await runSweep(failingStore('connection closed'));

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('saga recovery sweep failed');
    // The level matters as much as the message. Effect's own label is upper
    // case, and the service's logger bridge keys its mapping off exactly this
    // value — a sweep failure arriving as INFO is invisible to any level-based
    // alert while still being present in the log.
    expect(logs[0]?.level).toBe('ERROR');
    // Structured, not interpolated: the reason has to be queryable rather than
    // parsed back out of a rendered string.
    expect(logs[0]?.annotations['error']).toContain('connection closed');
  });

  it('never fails, so the daemon that repeats it cannot die', async () => {
    const outcome = await Effect.runPromise(
      Effect.either(sweepStale(failingStore('connection closed'), 1)),
    );

    expect(outcome._tag).toBe('Right');
  });
});

const anEvent = (transactionId: string): TransactionEvent => ({
  transactionId,
  entity: 'product-specification',
  state: 'COMPLETED',
  step: 'completed',
  at: '2026-01-01T00:00:00.000Z',
  organizationId: 'demo-organization',
});

/**
 * A client and database whose `withTransaction` runs the callback for real, so
 * the spec observes what actually commits together. The inbox collection throws
 * `E11000` on a repeated `(consumer, eventId)` exactly as the unique index
 * does, and — the half that matters — the transaction's *other* write is rolled
 * back with it, which is what makes the claim and the fold one fact.
 */
const fakeMongo = () => {
  const claims: string[] = [];
  const folds: string[] = [];
  let ended = 0;

  const client = {
    startSession: () => ({
      withTransaction: async (body: () => Promise<unknown>) => {
        const claimsBefore = [...claims];
        const foldsBefore = [...folds];
        try {
          return await body();
        } catch (error) {
          // Abort: neither write survives.
          claims.length = 0;
          claims.push(...claimsBefore);
          folds.length = 0;
          folds.push(...foldsBefore);
          throw error;
        }
      },
      endSession: async () => {
        ended += 1;
      },
    }),
  } as unknown as MongoClient;

  const db = {
    databaseName: 'transaction_manager',
    collection: (name: string) => ({
      insertOne: async (doc: { consumer: string; eventId: string }) => {
        const key = `${doc.consumer} ${doc.eventId}`;
        if (claims.includes(key)) {
          throw Object.assign(new Error('E11000'), { code: 11000 });
        }
        claims.push(key);
        return { acknowledged: true };
      },
      updateOne: async (filter: { transactionId: string }) => {
        folds.push(`${name} ${filter.transactionId}`);
        return { acknowledged: true };
      },
    }),
  } as unknown as Db;

  return {
    client,
    db,
    claims,
    folds,
    get sessionsEnded() {
      return ended;
    },
  };
};

const CONSUMER = 'transaction.transaction._star_';

describe('foldClaimed', () => {
  it('claims and folds a first delivery', async () => {
    const mongo = fakeMongo();

    const outcome = await Effect.runPromise(
      foldClaimed(
        mongo.client,
        mongo.db,
        CONSUMER,
        'tx-1:completed',
        anEvent('tx-1'),
      ),
    );

    expect(outcome).toBe('claimed');
    expect(mongo.claims).toEqual([`${CONSUMER} tx-1:completed`]);
    expect(mongo.folds).toEqual(['transactions tx-1']);
  });

  it('recognises a redelivery and folds nothing a second time', async () => {
    const mongo = fakeMongo();
    const event = anEvent('tx-2');
    await Effect.runPromise(
      foldClaimed(mongo.client, mongo.db, CONSUMER, 'tx-2:completed', event),
    );

    const outcome = await Effect.runPromise(
      foldClaimed(mongo.client, mongo.db, CONSUMER, 'tx-2:completed', event),
    );

    // `duplicate`, not a failure: the handler must ack. Nacking would requeue
    // against `x-delivery-limit` and eventually quarantine a message that was
    // in fact processed.
    expect(outcome).toBe('duplicate');
    expect(mongo.folds).toEqual(['transactions tx-2']);
  });

  it('claims each step of one transaction separately', async () => {
    const mongo = fakeMongo();

    await Effect.runPromise(
      foldClaimed(
        mongo.client,
        mongo.db,
        CONSUMER,
        'tx-3:accepted',
        anEvent('tx-3'),
      ),
    );
    const outcome = await Effect.runPromise(
      foldClaimed(
        mongo.client,
        mongo.db,
        CONSUMER,
        'tx-3:completed',
        anEvent('tx-3'),
      ),
    );

    // `<transactionId>:<step>`, never the correlation id — which would make
    // `completed` read as a redelivery of `accepted`.
    expect(outcome).toBe('claimed');
    expect(mongo.folds).toEqual(['transactions tx-3', 'transactions tx-3']);
  });

  it('does not let one consumer consume another consumer’s claim', async () => {
    const mongo = fakeMongo();
    await Effect.runPromise(
      foldClaimed(
        mongo.client,
        mongo.db,
        'a',
        'tx-4:completed',
        anEvent('tx-4'),
      ),
    );

    const outcome = await Effect.runPromise(
      foldClaimed(
        mongo.client,
        mongo.db,
        'b',
        'tx-4:completed',
        anEvent('tx-4'),
      ),
    );

    expect(outcome).toBe('claimed');
  });

  it('ends the session on both paths', async () => {
    const mongo = fakeMongo();
    const event = anEvent('tx-5');

    await Effect.runPromise(
      foldClaimed(mongo.client, mongo.db, CONSUMER, 'tx-5:completed', event),
    );
    await Effect.runPromise(
      foldClaimed(mongo.client, mongo.db, CONSUMER, 'tx-5:completed', event),
    );

    expect(mongo.sessionsEnded).toBe(2);
  });

  it('surfaces a failure that is not a duplicate key', async () => {
    const client = {
      startSession: () => ({
        withTransaction: async () => {
          throw new Error('not primary');
        },
        endSession: async () => undefined,
      }),
    } as unknown as MongoClient;

    const outcome = await Effect.runPromise(
      Effect.either(
        foldClaimed(
          client,
          fakeMongo().db,
          CONSUMER,
          'tx-6:completed',
          anEvent('tx-6'),
        ),
      ),
    );

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(
        'Failed to fold transaction event',
      );
      expect(outcome.left.details).toMatchObject({
        consumer: CONSUMER,
        eventId: 'tx-6:completed',
      });
    }
  });
});
