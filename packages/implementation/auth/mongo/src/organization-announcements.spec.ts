import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  OUTBOX_COLLECTION,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import type { EventBus } from '@entifix/transactions';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import { ORGANIZATION_ANNOUNCED } from '@r10c/business-ts-party-contracts';
import { Effect } from 'effect';
import { Layer } from 'effect';
import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  announcementOf,
  ORGANIZATION_COLLECTION,
  rebuildOrganizationAnnouncements,
  seedOrganizations,
  startOrganizationRebuild,
  writeOrganization,
} from './organization-announcements.js';

const SEED = { id: 'org-1', name: 'Demo Vendor', slug: 'demo-vendor' };
const FIRST = new Date('2026-10-23T10:00:00.000Z');
const LATER = new Date('2026-10-24T10:00:00.000Z');

const storeWith = async (
  seed: Record<string, Record<string, unknown>[]> = {},
) => {
  const fake = makeFakeMongoDb(seed);
  const db = fake.db as Db;
  await Effect.runPromise(ensureOutboxIndexes(db));
  const client = { startSession: () => fake.startSession() } as MongoClient;
  return { fake, db, client, bus: makeRecordingEventBus() };
};

const write = (
  store: Awaited<ReturnType<typeof storeWith>>,
  row: Record<string, unknown>,
  now: Date,
) =>
  Effect.runPromise(
    writeOrganization(store.client, store.db, row, 'auth', now).pipe(
      Effect.provideService(EventBusTag, store.bus),
      Effect.provideService(OutboxMaxAttempts, 3),
    ),
  );

describe('announcementOf', () => {
  it('names the organization at the moment of its last write', () => {
    expect(announcementOf({ ...SEED, updatedAt: FIRST })).toEqual({
      organizationId: 'org-1',
      displayName: 'Demo Vendor',
      announcedAt: FIRST.toISOString(),
    });
  });

  it.each([
    ['no id', { name: 'x', updatedAt: FIRST }],
    ['a blank name', { id: 'org-1', name: ' ', updatedAt: FIRST }],
    ['no stamp', { id: 'org-1', name: 'x' }],
    [
      'a stamp that is a string',
      { id: 'org-1', name: 'x', updatedAt: 'today' },
    ],
    ['an invalid date', { id: 'org-1', name: 'x', updatedAt: new Date('x') }],
  ])('has nothing to announce for a row with %s', (_label, row) => {
    expect(announcementOf(row)).toBeUndefined();
  });
});

describe('writeOrganization', () => {
  it('writes a new organization and its announcement together', async () => {
    const store = await storeWith();

    expect(await write(store, SEED, FIRST)).toBe('written');

    expect(store.fake.read(ORGANIZATION_COLLECTION)).toEqual([
      expect.objectContaining({ ...SEED, updatedAt: FIRST }),
    ]);
    const [entry] = store.fake.read(OUTBOX_COLLECTION);
    expect(entry?.['event']).toMatchObject({
      name: ORGANIZATION_ANNOUNCED,
      id: `org-1:${FIRST.toISOString()}`,
      source: 'auth',
      data: {
        organizationId: 'org-1',
        displayName: 'Demo Vendor',
        announcedAt: FIRST.toISOString(),
      },
    });
  });

  it('announces at commit rather than at the relay’s next sweep', async () => {
    const store = await storeWith();

    await write(store, SEED, FIRST);

    expect(store.bus.published.map(event => event.id)).toEqual([
      `org-1:${FIRST.toISOString()}`,
    ]);
  });

  it('leaves an unchanged organization alone, stamp and outbox included', async () => {
    // The seed runs on every boot. Re-stamping it would announce a rename
    // nobody made on every restart.
    const store = await storeWith();
    await write(store, SEED, FIRST);

    expect(await write(store, SEED, LATER)).toBe('unchanged');

    expect(store.fake.read(ORGANIZATION_COLLECTION)[0]?.['updatedAt']).toEqual(
      FIRST,
    );
    expect(store.fake.read(OUTBOX_COLLECTION)).toHaveLength(1);
  });

  it('announces a rename as a message of its own, at the new moment', async () => {
    const store = await storeWith();
    await write(store, SEED, FIRST);

    expect(await write(store, { ...SEED, name: 'Renamed' }, LATER)).toBe(
      'written',
    );

    const announced = store.fake
      .read(OUTBOX_COLLECTION)
      .map(entry => (entry['event'] as { id: string }).id);
    expect(announced).toEqual([
      `org-1:${FIRST.toISOString()}`,
      `org-1:${LATER.toISOString()}`,
    ]);
  });

  it('stamps a row written before stamps existed, so it can be announced', async () => {
    const store = await storeWith({ [ORGANIZATION_COLLECTION]: [{ ...SEED }] });

    expect(await write(store, SEED, FIRST)).toBe('written');
    expect(store.fake.read(OUTBOX_COLLECTION)).toHaveLength(1);
  });

  it('writes but announces nothing for a row with no name', async () => {
    const store = await storeWith();

    await write(store, { id: 'org-2', slug: 'nameless' }, FIRST);

    expect(store.fake.read(ORGANIZATION_COLLECTION)).toHaveLength(1);
    expect(store.fake.read(OUTBOX_COLLECTION)).toHaveLength(0);
  });

  it('fails as a connection error when the read or the write does', async () => {
    const unreadable = await storeWith();
    unreadable.fake.failOn('findOne', new Error('down'));
    const unwritable = await storeWith();
    unwritable.fake.failOn('updateOne', new Error('down'));

    await expect(write(unreadable, SEED, FIRST)).rejects.toThrow(
      'Failed to read an organization',
    );
    await expect(write(unwritable, SEED, FIRST)).rejects.toThrow(
      'Failed to write an organization',
    );
  });
});

describe('rebuildOrganizationAnnouncements', () => {
  const published: string[] = [];
  const bus = {
    publish: (event: { id: string }) =>
      Effect.sync(() => {
        published.push(event.id);
      }),
  } as unknown as EventBus;
  const rebuild = (db: Db) => {
    published.length = 0;
    return Effect.runPromise(rebuildOrganizationAnnouncements(db, bus, 'auth'));
  };

  it('re-announces at the stored stamp, never at now', async () => {
    const store = await storeWith({
      [ORGANIZATION_COLLECTION]: [{ ...SEED, updatedAt: FIRST }],
    });

    const report = await rebuild(store.db);

    expect(report.announced).toBe(1);
    // Left to the relay: a first announcement goes through the outbox.
    expect(published).toEqual([]);
    const [entry] = store.fake.read(OUTBOX_COLLECTION);
    expect((entry?.['event'] as { id: string }).id).toBe(
      `org-1:${FIRST.toISOString()}`,
    );
  });

  it('re-states what was already sent on the bus, and adds nothing to the outbox', async () => {
    // "Sent" is not "received": a fresh lab can send before the consumer's
    // queue exists, and the broker drops it. The re-statement is what repairs
    // that, with the same id and the same stamp.
    const store = await storeWith();
    await write(store, SEED, FIRST);

    const report = await rebuild(store.db);

    expect(report).toEqual({
      announced: 0,
      revived: 0,
      restated: 1,
      unannounceable: 0,
    });
    expect(published).toEqual([`org-1:${FIRST.toISOString()}`]);
    expect(store.fake.read(OUTBOX_COLLECTION)).toHaveLength(1);
  });

  it('puts a quarantined announcement back in the queue', async () => {
    const store = await storeWith();
    await write(store, SEED, FIRST);
    const [entry] = store.fake.read(OUTBOX_COLLECTION);
    store.fake.seed(OUTBOX_COLLECTION, [
      { ...entry, quarantined: true, attempts: 5 },
    ]);

    const report = await rebuild(store.db);

    expect(report.revived).toBe(1);
    expect(store.fake.read(OUTBOX_COLLECTION)[0]?.['quarantined']).toBe(false);
  });

  it('counts a row it cannot announce rather than failing the walk', async () => {
    const store = await storeWith({
      [ORGANIZATION_COLLECTION]: [
        { ...SEED },
        { id: 'org-2', name: 'Two', updatedAt: FIRST },
      ],
    });

    const report = await rebuild(store.db);

    expect(report.unannounceable).toBe(1);
    expect(report.announced).toBe(1);
  });

  it('fails as a connection error when the store cannot be read', async () => {
    const store = await storeWith();
    store.fake.failOn('find', new Error('down'));

    await expect(rebuild(store.db)).rejects.toThrow(
      'Failed to read the organizations',
    );
  });
});

describe('seeding and the boot walk', () => {
  const quietBus = { publish: () => Effect.void } as unknown as EventBus;
  const services = (store: Awaited<ReturnType<typeof storeWith>>) =>
    Layer.mergeAll(
      Layer.succeed(MongoClientTag, store.client),
      Layer.succeed(MongoDatabaseTag, store.db),
      Layer.succeed(EventBusTag, quietBus),
      Layer.succeed(OutboxMaxAttempts, 3),
      Layer.succeed(EventSourceTag, 'auth'),
    );

  it('seeds each organization through the announcing write', async () => {
    const store = await storeWith();

    await Effect.runPromise(
      seedOrganizations([SEED]).pipe(Effect.provide(services(store))),
    );

    expect(store.fake.read(ORGANIZATION_COLLECTION)).toHaveLength(1);
    expect(store.fake.read(OUTBOX_COLLECTION)).toHaveLength(1);
  });

  it('forks the walk past boot, and logs a walk that fails rather than failing the boot', async () => {
    const store = await storeWith();
    store.fake.failOn('find', new Error('network down'));

    await expect(
      Effect.runPromise(
        startOrganizationRebuild.pipe(
          Effect.andThen(Effect.sleep('10 millis')),
          Effect.provide(services(store)),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
