import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoOutbox, reviveQuarantined } from './store';

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

describe('reviveQuarantined', () => {
  /** Records the filter and update the one `updateOne` call is given. */
  const spyingDb = (modifiedCount: number) => {
    const calls: { filter: unknown; update: unknown }[] = [];
    const db = {
      databaseName: 'tenant_acme',
      collection: () => ({
        updateOne: async (filter: unknown, update: unknown) => {
          calls.push({ filter, update });
          return { modifiedCount };
        },
      }),
    } as unknown as Db;
    return { db, calls };
  };

  it('puts a quarantined entry back in the queue', async () => {
    const { db, calls } = spyingDb(1);

    const revived = await Effect.runPromise(reviveQuarantined(db, 'off-1:t'));

    expect(revived).toBe(true);
    expect(calls[0]?.update).toEqual({
      $set: { sent: false, quarantined: false, attempts: 0 },
      $unset: { lastError: '' },
    });
  });

  /**
   * ⚠️ The assertion that keeps this from becoming "re-announce everything".
   *
   * With `quarantined` in the **update** rather than the filter, a walk running
   * at every boot would re-send every already-delivered announcement in the
   * fleet and un-quarantine genuine poison each time — the re-drive loop
   * ADR 0030 closed deliberately.
   */
  it('only ever matches a quarantined entry', async () => {
    const { db, calls } = spyingDb(1);

    await Effect.runPromise(reviveQuarantined(db, 'off-1:t'));

    expect(calls[0]?.filter).toEqual({
      eventId: 'off-1:t',
      quarantined: true,
    });
  });

  it('answers false when the entry was pending, sent, or absent', async () => {
    // All three are one case at the driver: the filter matched nothing, so
    // nothing was modified. The walk reads that as "already announced".
    const { db } = spyingDb(0);

    expect(await Effect.runPromise(reviveQuarantined(db, 'off-2:t'))).toBe(
      false,
    );
  });

  it('fails rather than reporting a revival it did not make', async () => {
    const db = {
      databaseName: 'tenant_acme',
      collection: () => ({
        updateOne: async () => {
          throw new Error('connection reset');
        },
      }),
    } as unknown as Db;

    const outcome = await Effect.runPromise(
      Effect.either(reviveQuarantined(db, 'off-3:t')),
    );

    expect(outcome._tag).toBe('Left');
  });
});
