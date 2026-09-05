import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoOutbox } from './store';

describe('makeMongoOutbox.stats', () => {
  const withCollection = (collection: Record<string, unknown>) =>
    makeMongoOutbox({
      collection: () => collection,
    } as unknown as Db);

  it('counts the pending and quarantined sets separately', async () => {
    const stats = await Effect.runPromise(
      withCollection({
        countDocuments: async (filter: Record<string, unknown>) =>
          filter['quarantined'] === true ? 2 : 7,
        findOne: async () => ({ createdAt: '2026-01-01T00:00:00.000Z' }),
      }).stats(),
    );

    expect(stats.pending).toBe(7);
    expect(stats.quarantined).toBe(2);
    expect(stats.oldestPendingAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves the oldest timestamp absent when nothing is pending', async () => {
    const stats = await Effect.runPromise(
      withCollection({
        countDocuments: async () => 0,
        findOne: async () => null,
      }).stats(),
    );

    // Absent, not an epoch: the recorder turns absence into an age of zero, and
    // a fabricated timestamp here would report a decades-old backlog instead.
    expect(stats.oldestPendingAt).toBeUndefined();
  });

  it('reports a failure rather than a zero depth', async () => {
    const outcome = await Effect.runPromise(
      Effect.either(
        withCollection({
          countDocuments: async () => {
            throw new Error('connection reset');
          },
          findOne: async () => null,
        }).stats(),
      ),
    );

    // A zero here would read as "the outbox is empty", which is the opposite of
    // what a store that cannot be queried means.
    expect(outcome._tag).toBe('Left');
  });
});
