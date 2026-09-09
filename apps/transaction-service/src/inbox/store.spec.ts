import { describeTransactionInboxContract } from '@r10c/entifix-ts-testing-unit/contracts';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  ensureInboxIndexes,
  INBOX_COLLECTION,
  inboxDocument,
  isDuplicateKey,
  makeMongoInbox,
} from './store';

/** Mongo's duplicate-key error, as the driver actually raises it. */
const duplicateKeyError = () =>
  Object.assign(new Error('E11000'), { code: 11000 });

/**
 * A `Db` that behaves like the collection under its unique index: an insert of
 * a `(consumer, eventId)` already present throws `E11000`, exactly as Mongo
 * does. Everything else on `Db` is unreachable from this module.
 */
const fakeDb = () => {
  const inserted: Array<{ consumer: string; eventId: string }> = [];
  const indexes: Array<{ keys: unknown; options: unknown }> = [];
  let failIndexWith: Error | undefined;

  const db = {
    databaseName: 'transaction_manager',
    collection: () => ({
      insertOne: async (doc: { consumer: string; eventId: string }) => {
        if (
          inserted.some(
            entry =>
              entry.consumer === doc.consumer && entry.eventId === doc.eventId,
          )
        ) {
          throw duplicateKeyError();
        }
        inserted.push({ consumer: doc.consumer, eventId: doc.eventId });
        return { acknowledged: true };
      },
      createIndex: async (keys: unknown, options: unknown) => {
        if (failIndexWith) throw failIndexWith;
        indexes.push({ keys, options });
        return 'consumer_1_eventId_1';
      },
    }),
  } as unknown as Db;

  return {
    db,
    inserted,
    indexes,
    failIndexesWith: (error: Error) => {
      failIndexWith = error;
    },
  };
};

// The port contract, against the adapter's own duplicate-key translation.
// A shared `Db` across consumers is what makes the contract's isolation case
// real: both consumers insert into one collection, so an implementation keyed
// on `eventId` alone would fail here.
const shared = fakeDb();
describeTransactionInboxContract('mongo adapter', consumer =>
  makeMongoInbox(shared.db, consumer),
);

describe('inboxDocument', () => {
  it('carries both halves of the claim key and when it was taken', () => {
    const claim = inboxDocument(
      'transaction.transaction._star_',
      'tx-1:completed',
    );

    expect(claim.consumer).toBe('transaction.transaction._star_');
    expect(claim.eventId).toBe('tx-1:completed');
    expect(Date.parse(claim.claimedAt)).not.toBeNaN();
  });
});

describe('ensureInboxIndexes', () => {
  // Compound, and unique. Keyed on `eventId` alone the tracker's fold would
  // starve the SSE hub of every message while the broker, the queue and both
  // handlers went on reporting success.
  it('creates the unique index on (consumer, eventId)', async () => {
    const harness = fakeDb();

    await Effect.runPromise(ensureInboxIndexes(harness.db));

    expect(harness.indexes).toEqual([
      { keys: { consumer: 1, eventId: 1 }, options: { unique: true } },
    ]);
  });

  it('reports the database it could not index', async () => {
    const harness = fakeDb();
    harness.failIndexesWith(new Error('not primary'));

    const outcome = await Effect.runPromise(
      Effect.either(ensureInboxIndexes(harness.db)),
    );

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain('Failed to ensure inbox indexes');
      expect(outcome.left.details).toMatchObject({
        database: 'transaction_manager',
      });
    }
  });
});

describe('isDuplicateKey', () => {
  it('recognises Mongo’s duplicate-key code', () => {
    expect(isDuplicateKey(duplicateKeyError())).toBe(true);
  });

  it.each([
    ['a different driver code', Object.assign(new Error('x'), { code: 121 })],
    ['an error with no code', new Error('connection reset')],
    ['null', null],
    ['a string', 'E11000'],
  ])('does not mistake %s for one', (_label, value) => {
    expect(isDuplicateKey(value)).toBe(false);
  });
});

describe('makeMongoInbox', () => {
  it('surfaces a failure that is not a duplicate key', async () => {
    const db = {
      databaseName: 'transaction_manager',
      collection: () => ({
        insertOne: async () => {
          throw new Error('connection reset');
        },
      }),
    } as unknown as Db;

    const outcome = await Effect.runPromise(
      Effect.either(makeMongoInbox(db, 'a').claim('tx-1:completed')),
    );

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain('Failed to claim inbox entry');
      // Both halves of the key, so a failed claim is queryable by either.
      expect(outcome.left.details).toMatchObject({
        consumer: 'a',
        eventId: 'tx-1:completed',
      });
    }
  });

  it('writes the claim into the inbox collection', async () => {
    const harness = fakeDb();

    await Effect.runPromise(
      makeMongoInbox(harness.db, 'a').claim('tx-9:accepted'),
    );

    expect(harness.inserted).toEqual([
      { consumer: 'a', eventId: 'tx-9:accepted' },
    ]);
    expect(INBOX_COLLECTION).toBe('transaction_inbox');
  });
});
