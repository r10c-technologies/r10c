import {
  TenantDatabaseResolverTag,
  TenantDirectoryTag,
} from '@entifix/business';
import { isStoreFault } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { COMMAND_INBOX_COLLECTION } from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  Reservation,
  type StockLedger,
  StockLedgerTag,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import {
  CONTRACT_ORGANIZATIONS,
  describeStockLedgerContract,
} from '@r10c/business-ts-stock-management/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  MongoStockLedgerLayer,
  MOVEMENT_COLLECTION,
  RESERVATION_COLLECTION,
  STOCK_ITEM_COLLECTION,
} from './stock-ledger.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const named = (fake: Fake, name: string) =>
  Object.assign(fake.db as object, { databaseName: name }) as Db;

/** One organization's store, or several; the first fake is also the client. */
const world = (stores: Record<string, Fake> = { org: makeFakeMongoDb() }) => {
  const [client] = Object.values(stores) as [Fake];
  const dbs = Object.fromEntries(
    Object.entries(stores).map(([org, fake]) => [
      org,
      named(fake, `stock_${org}`),
    ]),
  );
  const layer = MongoStockLedgerLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoClientTag, client as never),
        Layer.succeed(TenantDatabaseResolverTag, {
          forOrganization: (organizationId: string) =>
            Effect.succeed(dbs[organizationId] as Db),
        }),
        Layer.succeed(TenantDirectoryTag, {
          list: () =>
            Effect.succeed(
              Object.entries(dbs).map(([organizationId, handle]) => ({
                organizationId,
                handle,
              })),
            ),
        }),
      ),
    ),
  );
  const run = <A, E>(use: (ledger: StockLedger) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* StockLedgerTag);
      }).pipe(Effect.provide(layer)),
    );
  return { run, stores };
};

describeStockLedgerContract('the Mongo ledger', () => {
  const stores = Object.fromEntries(
    CONTRACT_ORGANIZATIONS.map(org => [org, makeFakeMongoDb()]),
  );
  return world(stores).run(ledger => Effect.succeed(ledger));
});

const item = (offeringId: string, onHand: number, reserved = 0) => ({
  id: `item-${offeringId}`,
  offeringId,
  onHand,
  reserved,
});

const aHold = (id: string, quantity: number) =>
  Object.assign(new Reservation(), {
    id,
    offeringId: 'o-1',
    quantity,
    status: 'held',
    expiresAt: new Date(Date.now() + 60_000),
  });

const aMovement = (id: string, quantity: number, reason = 'receipt') =>
  Object.assign(new StockMovement('o-1', quantity, reason as never), { id });

const counterOf = (fake: Fake, offeringId = 'o-1') =>
  fake
    .read(STOCK_ITEM_COLLECTION)
    .find(doc => doc['offeringId'] === offeringId);

describe('taking a hold', () => {
  it('holds what is free, refuses what is not, and answers a redelivery with its first hold', async () => {
    const fake = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5, 2)],
    });
    const { run } = world({ org: fake });

    const held = await run(ledger =>
      ledger.take('org', aHold('r-1', 3), 'c-1'),
    );
    const refused = await run(ledger =>
      ledger.take('org', aHold('r-2', 1), undefined),
    );
    const again = await run(ledger =>
      ledger.take('org', aHold('r-3', 1), 'c-1'),
    );

    expect(held._tag).toBe('held');
    expect(refused).toEqual({ _tag: 'insufficient' });
    expect(again).toMatchObject({
      _tag: 'replayed',
      reservation: { id: 'r-1' },
    });
    expect(counterOf(fake)?.['reserved']).toBe(5);
  });

  it('refuses a duplicate that remembers no hold, and a remembered hold that will not read back', async () => {
    const fake = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5)],
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-empty', claimedAt: 'then' },
        {
          commandId: 'c-bad',
          claimedAt: 'then',
          replay: { record: 'not a record' },
        },
      ],
    });
    const { run } = world({ org: fake });

    const errors = await Promise.all([
      run(ledger =>
        Effect.flip(ledger.take('org', aHold('r-4', 1), 'c-empty')),
      ),
      run(ledger => Effect.flip(ledger.take('org', aHold('r-5', 1), 'c-bad'))),
    ]);

    expect(errors.every(isStoreFault)).toBe(true);
  });

  it('reports a take or a hold record the driver failed as store failures', async () => {
    const takeFails = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5)],
    });
    takeFails.failOn('updateOne', new Error('network down'));
    const recordFails = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5)],
    });
    recordFails.failOn('insertOne', new Error('disk full'));

    const errors = await Promise.all([
      world({ org: takeFails }).run(ledger =>
        Effect.flip(ledger.take('org', aHold('r-6', 1), undefined)),
      ),
      world({ org: recordFails }).run(ledger =>
        Effect.flip(ledger.take('org', aHold('r-7', 1), undefined)),
      ),
    ]);

    expect(errors.every(isStoreFault)).toBe(true);
  });
});

describe('ending a hold', () => {
  const seeded = () =>
    makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 10, 3)],
      [RESERVATION_COLLECTION]: [
        { id: 'r-1', offeringId: 'o-1', quantity: 3, status: 'held' },
      ],
    });

  it('releases a hold back to what is free', async () => {
    const fake = seeded();
    const { run } = world({ org: fake });

    const released = await run(ledger => ledger.end('org', 'r-1', 'released'));
    const again = await run(ledger => ledger.end('org', 'r-1', 'released'));

    expect([released, again]).toEqual(['transitioned', 'not-held']);
    expect(counterOf(fake)).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it('converts a hold into a sale, which leaves the shelf and the ledger says so', async () => {
    const fake = seeded();
    const { run } = world({ org: fake });

    await run(ledger => ledger.end('org', 'r-1', 'converted'));

    expect(counterOf(fake)).toMatchObject({ onHand: 7, reserved: 0 });
    expect(fake.read(MOVEMENT_COLLECTION)[0]).toMatchObject({
      quantity: -3,
      reason: 'sale',
    });
  });

  it('ends nothing when another writer ended the hold between the read and the write', async () => {
    const fake = seeded();
    const { run } = world({ org: fake });
    // The read sees it held; the conditional write finds it gone.
    const real = (
      fake.db as { collection: (name: string) => Record<string, unknown> }
    ).collection;
    (fake.db as { collection: unknown }).collection = (name: string) => {
      const collection = real(name);
      return name !== RESERVATION_COLLECTION
        ? collection
        : {
            ...collection,
            updateOne: () =>
              Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
          };
    };

    expect(await run(ledger => ledger.end('org', 'r-1', 'converted'))).toBe(
      'not-held',
    );
  });

  it('reports a hold the driver could not read as a store failure', async () => {
    const fake = seeded();
    fake.failOn('findOne', new Error('network down'));

    const error = await world({ org: fake }).run(ledger =>
      Effect.flip(ledger.end('org', 'r-1', 'released')),
    );

    expect(isStoreFault(error)).toBe(true);
  });

  it('reports each step of an end the driver failed as a store failure', async () => {
    const steps = ['updateOne', 'insertOne'];
    for (const op of steps) {
      const fake = seeded();
      fake.failOn(op, new Error(`${op} failed`));

      const error = await world({ org: fake }).run(ledger =>
        Effect.flip(ledger.end('org', 'r-1', 'converted')),
      );

      expect(isStoreFault(error)).toBe(true);
    }
    // The counter writes after the hold's own: fail only the second and third.
    for (const skip of [1, 2]) {
      const fake = seeded();
      const real = (
        fake.db as { collection: (name: string) => Record<string, unknown> }
      ).collection;
      let calls = 0;
      (fake.db as { collection: unknown }).collection = (name: string) => {
        const collection = real(name);
        return name !== STOCK_ITEM_COLLECTION
          ? collection
          : {
              ...collection,
              updateOne: (...args: unknown[]) => {
                calls += 1;
                return calls === skip
                  ? Promise.reject(new Error('counter write failed'))
                  : (
                      collection['updateOne'] as (
                        ...a: unknown[]
                      ) => Promise<unknown>
                    )(...args);
              },
            };
      };

      const error = await world({ org: fake }).run(ledger =>
        Effect.flip(ledger.end('org', 'r-1', 'converted')),
      );

      expect(isStoreFault(error)).toBe(true);
    }
  });
});

describe('recording and restoring', () => {
  it('appends a movement and moves the counter, creating the item on its first movement', async () => {
    const fake = makeFakeMongoDb();
    const { run } = world({ org: fake });

    await run(ledger => ledger.record('org', aMovement('m-1', 5)));
    await run(ledger => ledger.record('org', aMovement('m-2', 2)));

    expect(counterOf(fake)).toMatchObject({ onHand: 7, reserved: 0 });
    expect(fake.read(MOVEMENT_COLLECTION)).toHaveLength(2);
  });

  it('retries a first counter a sibling created under it, and gives up if that keeps happening', async () => {
    const once = makeFakeMongoDb();
    once.failOnce(
      'updateOne',
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    const always = makeFakeMongoDb();
    always.failOn(
      'updateOne',
      Object.assign(new Error('E11000'), { code: 11000 }),
    );

    await world({ org: once }).run(ledger =>
      ledger.record('org', aMovement('m-3', 1)),
    );
    const error = await world({ org: always }).run(ledger =>
      Effect.flip(ledger.record('org', aMovement('m-4', 1))),
    );

    expect(counterOf(once)?.['onHand']).toBe(1);
    expect(isStoreFault(error)).toBe(true);
  });

  it('reports a counter or a movement the driver failed as a store failure', async () => {
    const counterFails = makeFakeMongoDb();
    counterFails.failOn('updateOne', new Error('network down'));
    const appendFails = makeFakeMongoDb();
    appendFails.failOn('insertOne', new Error('disk full'));

    const errors = await Promise.all([
      world({ org: counterFails }).run(ledger =>
        Effect.flip(ledger.record('org', aMovement('m-5', 1))),
      ),
      world({ org: appendFails }).run(ledger =>
        Effect.flip(ledger.record('org', aMovement('m-6', 1))),
      ),
    ]);

    expect(errors.every(isStoreFault)).toBe(true);
  });

  it('restores once, and answers a redelivered command with its first restoration', async () => {
    const fake = makeFakeMongoDb({ [STOCK_ITEM_COLLECTION]: [item('o-1', 0)] });
    const { run } = world({ org: fake });

    const restored = await run(ledger =>
      ledger.restore('org', aMovement('m-7', 2, 'cancellation'), 'k-1'),
    );
    const again = await run(ledger =>
      ledger.restore('org', aMovement('m-8', 2, 'cancellation'), 'k-1'),
    );

    expect(restored._tag).toBe('restored');
    expect(again).toMatchObject({ _tag: 'replayed', movement: { id: 'm-7' } });
    expect(counterOf(fake)?.['onHand']).toBe(2);
  });
});

describe('releasing expired holds', () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  it('releases every expired hold in every organization, and leaves a fresh one', async () => {
    const one = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5, 2)],
      [RESERVATION_COLLECTION]: [
        {
          id: 'r-old',
          offeringId: 'o-1',
          quantity: 1,
          status: 'held',
          expiresAt: past,
        },
        {
          id: 'r-new',
          offeringId: 'o-1',
          quantity: 1,
          status: 'held',
          expiresAt: future,
        },
      ],
    });
    const two = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5, 1)],
      [RESERVATION_COLLECTION]: [
        {
          id: 'r-old-2',
          offeringId: 'o-1',
          quantity: 1,
          status: 'held',
          expiresAt: past,
        },
      ],
    });

    const released = await world({ one, two }).run(ledger =>
      ledger.releaseExpired(),
    );

    expect(released).toEqual({ released: 2, failed: [] });
    expect(counterOf(one)?.['reserved']).toBe(1);
    expect(counterOf(two)?.['reserved']).toBe(0);
  });

  it('reports a hold it could not release and goes on, and fails on a listing it could not read', async () => {
    const fake = makeFakeMongoDb({
      [STOCK_ITEM_COLLECTION]: [item('o-1', 5, 1)],
      [RESERVATION_COLLECTION]: [
        {
          id: 'r-old',
          offeringId: 'o-1',
          quantity: 1,
          status: 'held',
          expiresAt: past,
        },
      ],
    });
    fake.failOn('findOne', new Error('network down'));
    const unreadable = makeFakeMongoDb();
    unreadable.failOn('find', new Error('network down'));

    const sweep = await world({ org: fake }).run(ledger =>
      ledger.releaseExpired(),
    );

    expect(sweep.released).toBe(0);
    expect(sweep.failed).toHaveLength(1);
    expect(sweep.failed[0]).toMatchObject({ reservationId: 'r-old' });
    expect(sweep.failed[0]?.failure).toSatisfy(isStoreFault);
    expect(
      await world({ org: unreadable }).run(ledger =>
        Effect.flip(ledger.releaseExpired()),
      ),
    ).toSatisfy(isStoreFault);
  });
});

describe('MongoStockLedgerLayer', () => {
  it('ensures an organization’s counter index once, however many writes follow', async () => {
    const fake = makeFakeMongoDb();

    await world({ org: fake }).run(ledger =>
      Effect.andThen(ledger.record('org', aMovement('m-10', 1)), () =>
        ledger.record('org', aMovement('m-11', 1)),
      ),
    );

    expect(counterOf(fake)?.['onHand']).toBe(2);
  });

  it('reports a counter index it could not ensure as a store failure', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('createIndex', new Error('not primary'));

    const error = await world({ org: fake }).run(ledger =>
      Effect.flip(ledger.record('org', aMovement('m-9', 1))),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});
