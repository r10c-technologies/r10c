import { MongoDatabaseTag } from '@entifix/mongo';
import { MongoUnitOfWorkTag } from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import { Context, Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { failNth, mongoCellWorld } from './mongo.js';

class ProbeTag extends Context.Service<
  ProbeTag,
  { readonly source: string; readonly hasUnit: boolean; readonly db: Db }
>()('ProbeTag') {}

const ProbeLayer = Layer.effect(
  ProbeTag,
  Effect.gen(function* () {
    yield* EventBusTag;
    return {
      source: yield* EventSourceTag,
      hasUnit: (yield* MongoUnitOfWorkTag) !== undefined,
      db: yield* MongoDatabaseTag,
    };
  }),
);

describe('mongoCellWorld', () => {
  it('provides a store its database, unit of work, bus and source over one fake', async () => {
    const world = mongoCellWorld(ProbeLayer, {
      source: 'order',
      seed: { orders: [{ id: 'o-1' }] },
    });

    const probe = await world.run(
      Effect.gen(function* () {
        return yield* ProbeTag;
      }),
    );

    expect(probe).toMatchObject({ source: 'order', hasUnit: true });
    expect(probe.db).toBe(world.db);
    expect(world.fake.read('orders')).toHaveLength(1);
    expect(mongoCellWorld(ProbeLayer, { source: 's' }).fake.read('orders')).toEqual([]);
  });
});

describe('failNth', () => {
  it('fails only the nth call of one operation on one collection, a find at its cursor', async () => {
    const fake = makeFakeMongoDb({ a: [{ id: 1 }], b: [{ id: 2 }] });
    failNth(fake, 'a', 'findOne', 2);
    failNth(fake, 'a', 'find', 1);
    const db = fake.db as Db;

    const first = await db.collection('a').findOne({ id: 1 });
    const second = await db
      .collection('a')
      .findOne({ id: 1 })
      .catch((error: Error) => error.message);
    const cursor = await db
      .collection('a')
      .find({})
      .toArray()
      .catch((error: Error) => error.message);
    const other = await db.collection('b').findOne({ id: 2 });

    expect(first).toMatchObject({ id: 1 });
    expect(second).toBe('findOne #2 failed');
    expect(cursor).toBe('find #1 failed');
    expect(other).toMatchObject({ id: 2 });
  });
});
