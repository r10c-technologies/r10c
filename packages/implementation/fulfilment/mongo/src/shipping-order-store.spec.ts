import { TenantDatabaseResolverTag } from '@entifix/business';
import { isStoreFault } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { COMMAND_INBOX_COLLECTION } from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  ShippingLine,
  ShippingOrder,
  type ShippingOrderStore,
  ShippingOrderStoreTag,
} from '@r10c/business-ts-shipping-order-management';
import { describeShippingOrderStoreContract } from '@r10c/business-ts-shipping-order-management/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  MongoShippingOrderStoreLayer,
  SHIPPING_ORDER_COLLECTION,
} from './shipping-order-store.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const named = (fake: Fake, name: string) =>
  Object.assign(fake.db as object, { databaseName: name }) as Db;

/** One fake per organization; the first is also the client. */
const world = (
  stores: Record<string, Fake> = {
    'org-1': makeFakeMongoDb(),
    'org-2': makeFakeMongoDb(),
  },
) => {
  const [client] = Object.values(stores) as [Fake];
  const dbs = Object.fromEntries(
    Object.entries(stores).map(([org, fake]) => [
      org,
      named(fake, `fulfilment_${org}`),
    ]),
  );
  const bus = makeRecordingEventBus();
  const layer = MongoShippingOrderStoreLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoClientTag, client as never),
        Layer.succeed(TenantDatabaseResolverTag, {
          forOrganization: (organizationId: string) =>
            Effect.succeed(dbs[organizationId] as Db),
        }),
        Layer.succeed(EventBusTag, bus),
        Layer.succeed(OutboxMaxAttempts, 3),
        Layer.succeed(EventSourceTag, 'fulfilment'),
      ),
    ),
  );
  const run = <A, E>(use: (store: ShippingOrderStore) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* ShippingOrderStoreTag);
      }).pipe(Effect.provide(layer)) as Effect.Effect<A, E>,
    );
  return { run, stores, bus };
};

describeShippingOrderStoreContract('the Mongo store', () =>
  world().run(store => Effect.succeed(store)),
);

const AT = new Date('2026-11-03T10:00:00.000Z');

const aShipment = (id: string) =>
  Object.assign(new ShippingOrder(), {
    id,
    orderId: `order-${id}`,
    groupId: 'group-1',
    flowId: 'flow-1',
    paymentMethod: 'cod',
    amountDue: 2500,
    currency: 'GTQ',
    lines: [new ShippingLine('o-1', 2)],
  });

describe('announcing a move', () => {
  it('announces a dispatch and a delivery to the vendor, and a hold to nobody', async () => {
    const { run, bus } = world();
    await run(store => store.open('org-1', aShipment('s-1'), undefined));

    await run(store => store.transition('org-1', 's-1', 'hold', AT, undefined));
    await run(store =>
      store.transition('org-1', 's-1', 'release', AT, undefined),
    );
    await run(store =>
      store.transition('org-1', 's-1', 'dispatch', AT, undefined),
    );
    await run(store =>
      store.transition('org-1', 's-1', 'record-delivery', AT, undefined),
    );

    expect(
      bus.published.map(event => [event.name, event.correlationId]),
    ).toEqual([
      ['shipping-order.dispatched', 'flow-1'],
      ['shipping-order.delivered', 'flow-1'],
    ]);
    expect(bus.published[0]?.audience).toEqual([
      { kind: 'organization', id: 'org-1' },
    ]);
  });
});

describe('the store’s failures', () => {
  it('refuses a duplicate opening that remembers no shipment', async () => {
    const fake = makeFakeMongoDb({
      [COMMAND_INBOX_COLLECTION]: [{ commandId: 'c-ghost', claimedAt: 'then' }],
    });
    const { run } = world({ 'org-1': fake });

    const error = await run(store =>
      Effect.flip(store.open('org-1', aShipment('s-1'), 'c-ghost')),
    );

    expect(isStoreFault(error)).toBe(true);
  });

  it('reports a remembered shipment that will not read back as a store failure', async () => {
    const fake = makeFakeMongoDb({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-bad', claimedAt: 'then', replay: { record: 'nope' } },
      ],
    });
    const { run } = world({ 'org-1': fake });

    const error = await run(store =>
      Effect.flip(store.open('org-1', aShipment('s-1'), 'c-bad')),
    );

    expect(isStoreFault(error)).toBe(true);
  });

  it('reports reads and writes the driver failed as store failures', async () => {
    const writes = makeFakeMongoDb();
    writes.failOn('insertOne', new Error('disk full'));
    const reads = makeFakeMongoDb();
    reads.failOn('findOne', new Error('network down'));
    const moves = makeFakeMongoDb();
    const indexes = makeFakeMongoDb();
    indexes.failOn('createIndex', new Error('not primary'));

    const open = await world({ 'org-1': writes }).run(store =>
      Effect.flip(store.open('org-1', aShipment('s-1'), undefined)),
    );
    const read = await world({ 'org-1': reads }).run(store =>
      Effect.flip(store.get('org-1', 's-1')),
    );
    const movesWorld = world({ 'org-1': moves });
    await movesWorld.run(store =>
      store.open('org-1', aShipment('s-1'), undefined),
    );
    moves.failOn('findOneAndUpdate', new Error('network down'));
    const move = await movesWorld.run(store =>
      Effect.flip(store.transition('org-1', 's-1', 'dispatch', AT, undefined)),
    );
    const index = await world({ 'org-1': indexes }).run(store =>
      Effect.flip(store.get('org-1', 's-1')),
    );

    for (const failure of [open, read, move, index]) {
      expect(isStoreFault(failure)).toBe(true);
    }
  });

  it('keeps one shipment per vendor order', async () => {
    const fake = makeFakeMongoDb();
    const { run } = world({ 'org-1': fake });
    await run(store => store.open('org-1', aShipment('s-1'), undefined));

    const twice = await run(store =>
      Effect.flip(
        store.open(
          'org-1',
          Object.assign(aShipment('s-2'), { orderId: 'order-s-1' }),
          undefined,
        ),
      ),
    );

    expect(twice).toBeDefined();
    expect(fake.read(SHIPPING_ORDER_COLLECTION)).toHaveLength(1);
  });
});
