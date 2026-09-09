import type { DomainEvent } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  ensureOutboxIndexes,
  makeMongoOutbox,
  reviveQuarantined,
} from './store.js';

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

describe('makeMongoOutbox writes', () => {
  const anEvent = (id = 'e-1'): DomainEvent => ({
    name: 'order.placed',
    id,
    source: 'order',
    at: '2026-01-01T00:00:00.000Z',
    correlationId: 'order-1',
    data: {},
  });

  /** A collection that records what it was asked to do. */
  const spying = (overrides: Record<string, unknown> = {}) => {
    const calls: Record<string, unknown[]> = {
      insertOne: [],
      updateOne: [],
      find: [],
    };
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => [],
    };
    const collection = {
      insertOne: async (document: unknown) => {
        calls['insertOne']?.push(document);
        return {};
      },
      updateOne: async (filter: unknown, update: unknown) => {
        calls['updateOne']?.push({ filter, update });
        return {};
      },
      find: (filter: unknown, options: unknown) => {
        calls['find']?.push({ filter, options });
        return cursor;
      },
      ...overrides,
    };
    const outbox = makeMongoOutbox({
      databaseName: 'order',
      collection: () => collection,
    } as unknown as Db);
    return { outbox, calls };
  };

  it('enqueues an entry with its attempts defaulted', async () => {
    const { outbox, calls } = spying();

    const result = await Effect.runPromise(outbox.enqueue(anEvent()));

    expect(result).toBe('enqueued');
    expect(calls['insertOne']?.[0]).toMatchObject({
      eventId: 'e-1',
      sent: false,
      attempts: 0,
      quarantined: false,
    });
  });

  /**
   * ⚠️ Not a failure. The unique index rejecting a second claim for this message
   * id is precisely how a retry is identified — treating it as an error would
   * make every redelivery look like a broken outbox.
   */
  it('answers duplicate when the unique index rejects a second claim', async () => {
    const { outbox } = spying({
      insertOne: async () => {
        throw Object.assign(new Error('dup'), { code: 11000 });
      },
    });

    const result = await Effect.runPromise(outbox.enqueue(anEvent()));

    expect(result).toBe('duplicate');
  });

  it('reports a write that failed for any other reason', async () => {
    const { outbox } = spying({
      insertOne: async () => {
        throw new Error('connection reset');
      },
    });

    const outcome = await Effect.runPromise(
      Effect.either(outbox.enqueue(anEvent())),
    );

    expect(outcome._tag).toBe('Left');
  });

  it('drains only what is unsent and un-quarantined', async () => {
    const { outbox, calls } = spying();

    await Effect.runPromise(outbox.pending(10));

    expect(calls['find']?.[0]).toMatchObject({
      filter: { sent: false, quarantined: false },
    });
  });

  it('reports a pending read that failed', async () => {
    const { outbox } = spying({
      find: () => {
        throw new Error('connection reset');
      },
    });

    const outcome = await Effect.runPromise(Effect.either(outbox.pending(10)));

    expect(outcome._tag).toBe('Left');
  });

  it('marks an entry sent by its event id', async () => {
    const { outbox, calls } = spying();

    await Effect.runPromise(
      outbox.markSent({
        eventId: 'e-1',
        event: anEvent(),
        sent: false,
        attempts: 0,
        quarantined: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    expect(calls['updateOne']?.[0]).toEqual({
      filter: { eventId: 'e-1' },
      update: { $set: { sent: true } },
    });
  });

  it('reports a mark that failed', async () => {
    const { outbox } = spying({
      updateOne: async () => {
        throw new Error('connection reset');
      },
    });

    const outcome = await Effect.runPromise(
      Effect.either(
        outbox.markSent({
          eventId: 'e-1',
          event: anEvent(),
          sent: false,
          attempts: 0,
          quarantined: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    expect(outcome._tag).toBe('Left');
  });

  /**
   * ⚠️ `$inc`, never an absolute write. Two relays can drain the same database —
   * the request's inline drain and the daemon sweep — and an absolute write
   * would let one lose the other's attempt and stretch the ceiling indefinitely.
   */
  it('increments attempts rather than writing them', async () => {
    const { outbox, calls } = spying();

    await Effect.runPromise(
      outbox.recordFailure(
        {
          eventId: 'e-1',
          event: anEvent(),
          sent: false,
          attempts: 2,
          quarantined: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        'broker down',
        true,
      ),
    );

    expect(calls['updateOne']?.[0]).toEqual({
      filter: { eventId: 'e-1' },
      update: {
        $inc: { attempts: 1 },
        $set: { lastError: 'broker down', quarantined: true },
      },
    });
  });

  it('reports a failure record that itself failed', async () => {
    const { outbox } = spying({
      updateOne: async () => {
        throw new Error('connection reset');
      },
    });

    const outcome = await Effect.runPromise(
      Effect.either(
        outbox.recordFailure(
          {
            eventId: 'e-1',
            event: anEvent(),
            sent: false,
            attempts: 0,
            quarantined: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          'broker down',
          false,
        ),
      ),
    );

    expect(outcome._tag).toBe('Left');
  });
});

describe('ensureOutboxIndexes', () => {
  const spyingDb = (createIndex: (...args: unknown[]) => Promise<unknown>) =>
    ({
      databaseName: 'order',
      collection: () => ({ createIndex }),
    }) as unknown as Db;

  it('creates the unique claim index and the partial drain index', async () => {
    const created: unknown[] = [];

    await Effect.runPromise(
      ensureOutboxIndexes(
        spyingDb(async (keys: unknown, options: unknown) => {
          created.push({ keys, options });
          return 'ok';
        }),
      ),
    );

    expect(created[0]).toEqual({
      keys: { eventId: 1 },
      options: { unique: true },
    });
    expect(created[1]).toEqual({
      keys: { createdAt: 1 },
      options: {
        partialFilterExpression: { sent: false, quarantined: false },
      },
    });
  });

  /**
   * ⚠️ Reported rather than swallowed. Mongo rejects a `createIndex` that reuses
   * a key pattern with a different `partialFilterExpression`, and this runs on
   * every sweep — a database predating the filter fails here every pass, which
   * is only visible because the sweep logs what it catches.
   */
  it('reports a conflicting index rather than continuing', async () => {
    const outcome = await Effect.runPromise(
      Effect.either(
        ensureOutboxIndexes(
          spyingDb(async () => {
            throw new Error('IndexOptionsConflict');
          }),
        ),
      ),
    );

    expect(outcome._tag).toBe('Left');
  });
});

describe('reviveQuarantined, when the driver fails', () => {
  it('reports rather than answering false', async () => {
    const db = {
      databaseName: 'order',
      collection: () => ({
        updateOne: async () => {
          throw new Error('connection reset');
        },
      }),
    } as unknown as Db;

    const outcome = await Effect.runPromise(
      Effect.either(reviveQuarantined(db, 'e-1')),
    );

    // `false` would read as "there was nothing quarantined to revive", which is
    // the opposite of "we could not look".
    expect(outcome._tag).toBe('Left');
  });
});
