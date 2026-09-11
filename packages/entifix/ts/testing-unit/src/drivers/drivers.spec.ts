import type { SqlClient } from '@effect/sql';
import * as Statement from '@effect/sql/Statement';
import { Effect, Exit, Stream } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeFakeAmqpChannel } from './fake-amqp';
import { makeFakeMongoDb } from './fake-mongo';
import { makeFakeRedis } from './fake-redis';
import { makeFakeSqlClient } from './fake-sql';

/**
 * The driver fakes sit one level below the adapters, so the adapters' own code
 * runs against them. That only works if the fakes honour the semantics the
 * adapters depend on — which is what these tests are for.
 */

interface FakeCursor {
  sort(spec: Record<string, 1 | -1>): FakeCursor;
  skip(count: number): FakeCursor;
  limit(count: number): FakeCursor;
  toArray(): Promise<Record<string, unknown>[]>;
}

interface FakeCollection {
  find(
    query?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): FakeCursor;
  findOne(
    query: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  countDocuments(query?: Record<string, unknown>): Promise<number>;
  insertMany(
    documents: Array<Record<string, unknown>>,
  ): Promise<{ insertedCount: number }>;
  insertOne(
    document: Record<string, unknown>,
  ): Promise<{ acknowledged: boolean; insertedId: unknown }>;
  replaceOne(
    query: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; upsertedCount: number }>;
  updateOne(
    query: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $addToSet?: Record<string, unknown>;
      $inc?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
    },
    options?: { upsert?: boolean },
  ): Promise<{
    matchedCount: number;
    modifiedCount: number;
    upsertedCount?: number;
  }>;
  updateMany(
    query: Record<string, unknown>,
    update: { $set?: Record<string, unknown> },
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
  findOneAndUpdate(
    query: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
    },
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' },
  ): Promise<Record<string, unknown> | null>;
  deleteOne(query: Record<string, unknown>): Promise<{ deletedCount: number }>;
  createIndex(
    spec: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

const collectionOf = (
  fake: ReturnType<typeof makeFakeMongoDb>,
  name: string,
): FakeCollection =>
  (fake.db as { collection(name: string): FakeCollection }).collection(name);

describe('makeFakeMongoDb', () => {
  const seeded = () =>
    makeFakeMongoDb({
      widget: [
        { _id: 'internal-1', id: 'w-1', name: 'Alpha', size: 10 },
        { _id: 'internal-2', id: 'w-2', name: 'Beta', size: 30 },
        { _id: 'internal-3', id: 'w-3', name: 'Gamma', size: 20 },
      ],
    });

  it('copies the seed rather than aliasing it', async () => {
    const documents = [{ id: 'w-1' }];
    const fake = makeFakeMongoDb({ widget: documents });

    await collectionOf(fake, 'widget').replaceOne(
      { id: 'w-1' },
      { id: 'w-1', name: 'x' },
    );

    expect(documents[0]).toEqual({ id: 'w-1' });
  });

  it('serves an unknown collection as empty', async () => {
    expect(
      await collectionOf(makeFakeMongoDb(), 'absent').find().toArray(),
    ).toEqual([]);
  });

  describe('find', () => {
    it('matches on equality', async () => {
      const found = await collectionOf(seeded(), 'widget')
        .find({ id: 'w-2' })
        .toArray();

      expect(found.map(doc => doc['name'])).toEqual(['Beta']);
    });

    /**
     * The query a scoped order read sends: a path into an embedded collection.
     * Matching only the top-level field would answer empty here while the real
     * server answers the order, which is a spec that passes and asserts the
     * opposite of what it claims.
     */
    it('matches a dotted path through an array, element-wise', async () => {
      const db = makeFakeMongoDb({
        order: [
          { id: 'o-1', items: [{ vendorId: 'v-1' }, { vendorId: 'v-2' }] },
          { id: 'o-2', items: [{ vendorId: 'v-3' }] },
        ],
      });

      const found = await collectionOf(db, 'order')
        .find({ 'items.vendorId': 'v-2' })
        .toArray();

      expect(found.map(doc => doc['id'])).toEqual(['o-1']);
    });

    it('matches a dotted path through a nested object', async () => {
      const db = makeFakeMongoDb({
        order: [{ id: 'o-1', channel: { type: 'storefront' } }],
      });

      const found = await collectionOf(db, 'order')
        .find({ 'channel.type': 'storefront' })
        .toArray();

      expect(found).toHaveLength(1);
    });

    /**
     * The asymmetry the server has and a naive `some()` does not: an order with
     * a line for `v-1` is excluded by `$ne: 'v-1'`, even though its other line
     * differs.
     */
    it('excludes a document when any value at the path matches a negation', async () => {
      const db = makeFakeMongoDb({
        order: [
          { id: 'o-1', items: [{ vendorId: 'v-1' }, { vendorId: 'v-2' }] },
          { id: 'o-2', items: [{ vendorId: 'v-3' }] },
        ],
      });

      const found = await collectionOf(db, 'order')
        .find({ 'items.vendorId': { $ne: 'v-1' } })
        .toArray();

      expect(found.map(doc => doc['id'])).toEqual(['o-2']);
    });

    it('treats a path that descends through a scalar as absent', async () => {
      const db = makeFakeMongoDb({ order: [{ id: 'o-1', items: 7 }] });
      const collection = collectionOf(db, 'order');

      expect(
        await collection.find({ 'items.vendorId': 'v-1' }).toArray(),
      ).toHaveLength(0);
      // Absent, not merely unmatched: the document *is* one whose path holds
      // nothing, which is what `$eq: undefined` asks about.
      expect(
        await collection.find({ 'items.vendorId': undefined }).toArray(),
      ).toHaveLength(1);
    });

    it('matches a scalar against the array that contains it', async () => {
      const db = makeFakeMongoDb({ order: [{ id: 'o-1', tags: ['a', 'b'] }] });

      const found = await collectionOf(db, 'order')
        .find({ tags: 'a' })
        .toArray();

      expect(found).toHaveLength(1);
    });

    it('sorts ascending and descending', async () => {
      const collection = collectionOf(seeded(), 'widget');

      const ascending = await collection.find({}).sort({ size: 1 }).toArray();
      const descending = await collectionOf(seeded(), 'widget')
        .find({})
        .sort({ size: -1 })
        .toArray();

      expect(ascending.map(doc => doc['size'])).toEqual([10, 20, 30]);
      expect(descending.map(doc => doc['size'])).toEqual([30, 20, 10]);
    });

    it('pages with skip and limit', async () => {
      const found = await collectionOf(seeded(), 'widget')
        .find({})
        .sort({ size: 1 })
        .skip(1)
        .limit(1)
        .toArray();

      expect(found.map(doc => doc['size'])).toEqual([20]);
    });

    // The adapter projects `_id` away on every read, so the fake has to honour
    // that projection or an entity would arrive carrying Mongo's own key.
    it('honours the _id projection', async () => {
      const found = await collectionOf(seeded(), 'widget')
        .find({}, { projection: { _id: 0 } })
        .toArray();

      expect(found[0]).not.toHaveProperty('_id');
    });

    it('keeps _id without the projection', async () => {
      const found = await collectionOf(seeded(), 'widget').find({}).toArray();

      expect(found[0]).toHaveProperty('_id');
    });
  });

  describe('the other operations', () => {
    it('findOne returns the match, or null', async () => {
      const collection = collectionOf(seeded(), 'widget');

      expect((await collection.findOne({ id: 'w-1' }))?.['name']).toBe('Alpha');
      expect(await collection.findOne({ id: 'missing' })).toBeNull();
    });

    it('insertMany appends copies, so a seed array cannot be aliased', async () => {
      const fake = seeded();
      const collection = collectionOf(fake, 'widget');
      const incoming = [{ id: 'w-4', name: 'Delta' }];

      const result = await collection.insertMany(incoming);
      incoming[0]['name'] = 'mutated';

      expect(result).toEqual({ insertedCount: 1 });
      expect(await collection.countDocuments({})).toBe(4);
      expect(fake.read('widget')[3]).toEqual({ id: 'w-4', name: 'Delta' });
    });

    it('countDocuments counts the whole match', async () => {
      expect(await collectionOf(seeded(), 'widget').countDocuments({})).toBe(3);
    });

    it('replaceOne replaces an existing document', async () => {
      const fake = seeded();

      const result = await collectionOf(fake, 'widget').replaceOne(
        { id: 'w-1' },
        { id: 'w-1', name: 'Renamed' },
      );

      expect(result).toEqual({ matchedCount: 1, upsertedCount: 0 });
      expect(fake.read('widget')[0]).toEqual({ id: 'w-1', name: 'Renamed' });
    });

    it('replaceOne inserts when upserting a missing document', async () => {
      const fake = seeded();

      const result = await collectionOf(fake, 'widget').replaceOne(
        { id: 'w-9' },
        { id: 'w-9' },
        { upsert: true },
      );

      expect(result).toEqual({ matchedCount: 0, upsertedCount: 1 });
      expect(fake.read('widget')).toHaveLength(4);
    });

    it('replaceOne does nothing for a missing document without upsert', async () => {
      const fake = seeded();

      const result = await collectionOf(fake, 'widget').replaceOne(
        { id: 'w-9' },
        { id: 'w-9' },
      );

      expect(result).toEqual({ matchedCount: 0, upsertedCount: 0 });
      expect(fake.read('widget')).toHaveLength(3);
    });

    it('updateOne applies $set to the matching document only', async () => {
      const fake = seeded();
      const collection = collectionOf(fake, 'widget');

      const result = await collection.updateOne(
        { id: 'w-2' },
        {
          $set: { name: 'Renamed' },
        },
      );

      expect(result).toEqual({
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
      });
      // The untouched members survive, and the neighbours are unchanged.
      expect(await collection.findOne({ id: 'w-2' })).toMatchObject({
        name: 'Renamed',
        size: 30,
      });
      expect(await collection.findOne({ id: 'w-1' })).toMatchObject({
        name: 'Alpha',
      });
    });

    it('updateOne without $set leaves the document alone', async () => {
      const collection = collectionOf(seeded(), 'widget');

      const result = await collection.updateOne({ id: 'w-1' }, {});

      expect(result).toEqual({
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
      });
      expect(await collection.findOne({ id: 'w-1' })).toMatchObject({
        name: 'Alpha',
      });
    });

    it('updateOne appends a new member with $addToSet', async () => {
      const fake = seeded();
      const collection = collectionOf(fake, 'widget');

      await collection.updateOne({ id: 'w-1' }, { $addToSet: { tags: 'a' } });
      await collection.updateOne({ id: 'w-1' }, { $addToSet: { tags: 'b' } });

      expect(await collection.findOne({ id: 'w-1' })).toMatchObject({
        tags: ['a', 'b'],
      });
    });

    // The whole reason to use it over `$push`: a repair run re-asserts a link it
    // already made, and must not end up with the id twice.
    it('updateOne ignores a duplicate with $addToSet', async () => {
      const collection = collectionOf(seeded(), 'widget');

      await collection.updateOne({ id: 'w-1' }, { $addToSet: { tags: 'a' } });
      await collection.updateOne({ id: 'w-1' }, { $addToSet: { tags: 'a' } });

      expect(await collection.findOne({ id: 'w-1' })).toMatchObject({
        tags: ['a'],
      });
    });

    // A fake that accepted an operator it does not apply would let a spec pass
    // on an update that never happened — worse than not supporting it at all.
    // `$inc` was this example until the stock ledger needed it. The rule is the
    // one that matters, not the operator: `$unset` stands in now.
    it('updateOne throws on an operator it does not implement', async () => {
      const collection = collectionOf(seeded(), 'widget');

      await expect(
        collection.updateOne({ id: 'w-1' }, {
          $unset: { size: '' },
        } as unknown as { $set?: Record<string, unknown> }),
      ).rejects.toThrow('$unset');
    });

    it('updateOne reports a miss for a document that is not there', async () => {
      const result = await collectionOf(seeded(), 'widget').updateOne(
        { id: 'missing' },
        { $set: { name: 'x' } },
      );

      expect(result).toEqual({
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      });
    });

    it('deleteOne removes a match and reports a miss', async () => {
      const fake = seeded();
      const collection = collectionOf(fake, 'widget');

      expect(await collection.deleteOne({ id: 'w-1' })).toEqual({
        deletedCount: 1,
      });
      expect(await collection.deleteOne({ id: 'w-1' })).toEqual({
        deletedCount: 0,
      });
      expect(fake.read('widget')).toHaveLength(2);
    });

    it('createIndex records what was asked for', async () => {
      const fake = seeded();

      await collectionOf(fake, 'widget').createIndex(
        { id: 1 },
        { unique: true },
      );

      expect(fake.operations.at(-1)).toEqual({
        collection: 'widget',
        op: 'createIndex',
      });
    });
  });

  describe('failures', () => {
    it('failWith rejects every operation', async () => {
      const fake = seeded();
      fake.failWith(new Error('connection refused'));

      await expect(
        collectionOf(fake, 'widget').find({}).toArray(),
      ).rejects.toThrow('connection refused');
    });

    // A blanket failure never gets past the first call, so the later error
    // branches are only reachable per-operation.
    it('failOn rejects only the named operation', async () => {
      const fake = seeded();
      fake.failOn('countDocuments', new Error('connection refused'));
      const collection = collectionOf(fake, 'widget');

      await expect(collection.find({}).toArray()).resolves.toHaveLength(3);
      await expect(collection.countDocuments({})).rejects.toThrow(
        'connection refused',
      );
    });
  });

  it('seed replaces a collection wholesale', () => {
    const fake = seeded();

    fake.seed('widget', [{ id: 'w-9' }]);

    expect(fake.read('widget')).toEqual([{ id: 'w-9' }]);
  });

  it('read hands back copies, so a caller cannot mutate the store', () => {
    const fake = seeded();

    fake.read('widget')[0]!['name'] = 'Tampered';

    expect(fake.read('widget')[0]?.['name']).toBe('Alpha');
  });
});

interface FakeRedisClient {
  set(key: string, value: string, ...rest: unknown[]): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  incr(key: string): Promise<number>;
  eval(
    script: string,
    numKeys: number,
    key: string,
    token: string,
  ): Promise<number>;
  quit(): Promise<string>;
  ttl(key: string): Promise<number>;
  getdel(key: string): Promise<string | null>;
  scard(key: string): Promise<number>;
}

describe('makeFakeRedis', () => {
  const client = (fake: ReturnType<typeof makeFakeRedis>) =>
    fake.redis as FakeRedisClient;

  // `NX` is what makes acquisition atomic across instances, so honouring it is
  // the whole reason this fake exists rather than a plain Map.
  it('refuses to overwrite a held key under NX', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('lock', 'mine', 'PX', 1000, 'NX');

    expect(
      await client(fake).set('lock', 'theirs', 'PX', 1000, 'NX'),
    ).toBeNull();
    expect(fake.read('lock')).toBe('mine');
  });

  it('overwrites without NX', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('lock', 'mine');

    expect(await client(fake).set('lock', 'theirs')).toBe('OK');
    expect(fake.read('lock')).toBe('theirs');
  });

  it('reads and deletes', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('key', 'value');

    expect(await client(fake).get('key')).toBe('value');
    expect(await client(fake).del('key')).toBe(1);
    expect(await client(fake).del('key')).toBe(0);
    expect(await client(fake).get('key')).toBeNull();
  });

  it('increments from nothing', async () => {
    const fake = makeFakeRedis();

    expect(await client(fake).incr('seq')).toBe(1);
    expect(await client(fake).incr('seq')).toBe(2);
  });

  // The session store indexes a user's live session ids in a set so they can be
  // revoked as a group; the fake has to honour the set semantics that relies on.
  it('adds set members, ignoring duplicates', async () => {
    const fake = makeFakeRedis();

    expect(await client(fake).sadd('user:1', 's-1')).toBe(1);
    expect(await client(fake).sadd('user:1', 's-1')).toBe(0);
    expect(await client(fake).sadd('user:1', 's-2')).toBe(1);
    expect(await client(fake).smembers('user:1')).toEqual(['s-1', 's-2']);
  });

  it('removes a set member and reports a miss', async () => {
    const fake = makeFakeRedis();
    await client(fake).sadd('user:1', 's-1');

    expect(await client(fake).srem('user:1', 's-1')).toBe(1);
    expect(await client(fake).srem('user:1', 's-1')).toBe(0);
    expect(await client(fake).srem('missing', 's-1')).toBe(0);
  });

  it('returns an empty array for a missing set', async () => {
    expect(await client(makeFakeRedis()).smembers('missing')).toEqual([]);
  });

  it('counts set members', async () => {
    const fake = makeFakeRedis();
    await client(fake).sadd('sources', 'a');
    await client(fake).sadd('sources', 'b');

    expect(await client(fake).scard('sources')).toBe(2);
    expect(await client(fake).scard('missing')).toBe(0);
  });

  // `GETDEL` is what makes redeeming a single-use token atomic: two requests
  // racing the same link must not both succeed.
  it('reads and removes in one step', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('token', 'user-1');

    expect(await client(fake).getdel('token')).toBe('user-1');
    expect(await client(fake).getdel('token')).toBeNull();
  });

  // Time does not pass here, so `TTL` reports whatever was last requested —
  // enough for an adapter branching on "is this still alive".
  it('reports the ttl it was given', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('locked', '1', 'EX', 900);

    expect(await client(fake).ttl('locked')).toBe(900);
  });

  it('reports -2 for a missing key and -1 for one with no expiry', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('forever', 'value');

    expect(await client(fake).ttl('gone')).toBe(-2);
    expect(await client(fake).ttl('forever')).toBe(-1);
  });

  it('records a ttl set through expire', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('key', 'value');
    await client(fake).expire('key', 60);

    expect(await client(fake).ttl('key')).toBe(60);
  });

  it('deletes a set key too', async () => {
    const fake = makeFakeRedis();
    await client(fake).sadd('user:1', 's-1');

    expect(await client(fake).del('user:1')).toBe(1);
    expect(await client(fake).smembers('user:1')).toEqual([]);
  });

  // `EXPIRE` is how the adapter re-arms a sliding TTL and how it detects that a
  // session vanished: 1 when the key still exists, 0 when it is gone.
  it('reports whether a key exists on expire', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('rec', 'value');
    await client(fake).sadd('idx', 'm');

    expect(await client(fake).expire('rec', 60)).toBe(1);
    expect(await client(fake).expire('idx', 60)).toBe(1);
    expect(await client(fake).expire('missing', 60)).toBe(0);
  });

  // The release script is a compare-and-delete: free the key only when it
  // still holds our own token.
  it('eval frees a key only for its own token', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('lock', 'mine');

    expect(await client(fake).eval('script', 1, 'lock', 'theirs')).toBe(0);
    expect(fake.read('lock')).toBe('mine');
    expect(await client(fake).eval('script', 1, 'lock', 'mine')).toBe(1);
    expect(fake.read('lock')).toBeUndefined();
  });

  it('quits', async () => {
    expect(await client(makeFakeRedis()).quit()).toBe('OK');
  });

  it('holds and frees a key on the test’s behalf', async () => {
    const fake = makeFakeRedis();

    fake.hold('lock');
    expect(await client(fake).set('lock', 'mine', 'NX')).toBeNull();

    fake.free('lock');
    expect(await client(fake).set('lock', 'mine', 'NX')).toBe('OK');
  });

  it('holds with an explicit token', () => {
    const fake = makeFakeRedis();

    fake.hold('lock', 'their-token');

    expect(fake.read('lock')).toBe('their-token');
  });

  it('records every command with its arguments', async () => {
    const fake = makeFakeRedis();

    await client(fake).set('lock', 'mine', 'PX', 1000, 'NX');

    expect(fake.commands).toEqual([
      { command: 'set', args: ['lock', 'mine', 'PX', 1000, 'NX'] },
    ]);
  });

  it('rejects every command once told to fail', async () => {
    const fake = makeFakeRedis();
    fake.failWith(new Error('connection reset'));

    await expect(client(fake).get('key')).rejects.toThrow('connection reset');
  });
});

interface FakeChannel {
  publish(exchange: string, routingKey: string, content: Buffer): boolean;
  prefetch(count: number): Promise<void>;
  assertExchange(
    exchange: string,
    type: string,
    options?: Record<string, unknown>,
  ): Promise<{ exchange: string }>;
  assertQueue(
    queue: string,
    options?: Record<string, unknown>,
  ): Promise<{ queue: string }>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<void>;
  consume(
    queue: string,
    handler: (message: { content: Buffer } | null) => void,
  ): Promise<{ consumerTag: string }>;
  cancel(consumerTag: string): Promise<void>;
  ack(message: { content: Buffer }): void;
  nack(message: { content: Buffer }, allUpTo: boolean, requeue: boolean): void;
  close(): Promise<void>;
}

describe('makeFakeAmqpChannel', () => {
  const channelOf = (fake: ReturnType<typeof makeFakeAmqpChannel>) =>
    fake.channel as FakeChannel;

  it('records what was published, decoded, with its routing key', () => {
    const fake = makeFakeAmqpChannel();

    channelOf(fake).publish(
      'events',
      'widget.created',
      Buffer.from(JSON.stringify({ a: 1 })),
    );

    expect(fake.published).toEqual([
      { exchange: 'events', routingKey: 'widget.created', body: { a: 1 } },
    ]);
  });

  // The saga tracker's event fold depends on `prefetch(1)`: without it,
  // accepted and completed events race into duplicate records.
  it('records the prefetch the consumer asked for', async () => {
    const fake = makeFakeAmqpChannel();

    await channelOf(fake).prefetch(1);

    expect(fake.prefetchCount).toBe(1);
  });

  it('asserts an exchange and a named queue', async () => {
    const channel = channelOf(makeFakeAmqpChannel());

    expect(await channel.assertExchange('events', 'topic')).toEqual({
      exchange: 'events',
    });
    expect(await channel.assertQueue('work')).toEqual({ queue: 'work' });
  });

  // An empty queue name means "give me an exclusive generated one", which every
  // subscriber relies on: a shared queue would deliver each event to one
  // replica.
  it('generates a queue name for the empty string', async () => {
    expect(await channelOf(makeFakeAmqpChannel()).assertQueue('')).toEqual({
      queue: 'amq.gen-fake',
    });
  });

  it('records the binding a queue was given', async () => {
    const fake = makeFakeAmqpChannel();

    await channelOf(fake).bindQueue('work', 'events', 'widget.*');

    expect(fake.bindings).toEqual([
      { queue: 'work', exchange: 'events', pattern: 'widget.*' },
    ]);
  });

  it('delivers to a subscriber whose binding matches the routing key', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).bindQueue('work', 'events', 'widget.*');
    await channelOf(fake).consume('work', message => {
      received.push(JSON.parse(message?.content.toString() ?? 'null'));
    });

    await fake.deliver({ a: 1 }, 'widget.created');

    expect(received).toEqual([{ a: 1 }]);
  });

  // Routing is the broker's job, so the fake has to do it too: a fake that
  // handed every message to every consumer would let a wrong bind pattern pass
  // every test the adapters have.
  it('drops a delivery no binding matches', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).bindQueue('work', 'events', 'gadget.*');
    await channelOf(fake).consume('work', message => received.push(message));

    await fake.deliver({ a: 1 }, 'widget.created');

    expect(received).toEqual([]);
  });

  // An envelope routes under its own `meta.event.name`, which is the key the
  // adapter publishes with — so a delivery needs no second copy of it.
  it('derives the routing key from the envelope’s own event name', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).bindQueue('work', 'events', 'widget.*');
    await channelOf(fake).consume('work', message => received.push(message));

    await fake.deliver({
      meta: { type: 'event', event: { name: 'widget.created', id: 'w-1' } },
      data: { a: 1 },
    });

    expect(received).toHaveLength(1);
  });

  // A body carrying no `meta.event.name` has no routing key at all, so nothing
  // but a `#` binding can receive it. That is the honest simulation: the broker
  // would have routed on whatever key the publisher set, not on the content.
  it('routes a body with no event metadata under an empty key', async () => {
    const fake = makeFakeAmqpChannel();
    const narrow: unknown[] = [];
    await channelOf(fake).bindQueue('work', 'events', 'widget.*');
    await channelOf(fake).consume('work', message => narrow.push(message));

    await fake.deliver({ not: 'an envelope' });

    expect(narrow).toEqual([]);

    const wide = makeFakeAmqpChannel();
    const caught: unknown[] = [];
    await channelOf(wide).bindQueue('work', 'events', '#');
    await channelOf(wide).consume('work', message => caught.push(message));

    await wide.deliver({ not: 'an envelope' });

    expect(caught).toHaveLength(1);
  });

  it('delivers a raw payload, so a malformed message can be tested', async () => {
    const fake = makeFakeAmqpChannel();
    const received: string[] = [];
    // No binding: a raw payload is the already-routed, malformed-content path.
    await channelOf(fake).consume('work', message => {
      received.push(message?.content.toString() ?? '');
    });

    await fake.deliverRaw('not json');

    expect(received).toEqual(['not json']);
  });

  // Cancelling is a graceful shutdown's first phase, and the tag is the only
  // handle on it — so the fake hands out a distinct one per `consume` and
  // records what was cancelled.
  it('records a cancelled consumer by its own tag, and stops delivering', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    const first = await channelOf(fake).consume('work', () =>
      received.push('first'),
    );
    const second = await channelOf(fake).consume('other', () =>
      received.push('second'),
    );

    expect(first.consumerTag).not.toBe(second.consumerTag);

    await channelOf(fake).cancel(second.consumerTag);

    expect(fake.cancelled).toEqual([second.consumerTag]);
    await expect(fake.deliver({ a: 1 })).rejects.toThrow(/nothing subscribed/);
    expect(received).toEqual([]);
  });

  // A null delivery is how amqplib signals the consumer was cancelled.
  it('delivers a cancellation', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).consume('work', message => received.push(message));

    await fake.deliverCancellation();

    expect(received).toEqual([null]);
  });

  it.each([
    [
      'a delivery',
      (fake: ReturnType<typeof makeFakeAmqpChannel>) => fake.deliver({ a: 1 }),
    ],
    [
      'a cancellation',
      (fake: ReturnType<typeof makeFakeAmqpChannel>) =>
        fake.deliverCancellation(),
    ],
  ])('refuses %s before anything subscribed', async (_label, deliver) => {
    await expect(deliver(makeFakeAmqpChannel())).rejects.toThrow(
      /nothing subscribed/,
    );
  });

  it('records acks and nacks', () => {
    const fake = makeFakeAmqpChannel();
    const message = { content: Buffer.from('{}') };

    channelOf(fake).ack(message);
    channelOf(fake).nack(message, false, true);

    expect(fake.acked).toEqual([message]);
    // The flags, not just the fact: `requeue` is the whole difference between
    // "retry this" and "quarantine it", and a fake that dropped them let a bus
    // that discarded every failure pass a test named for dead-lettering.
    expect(fake.nacked).toEqual([{ message, allUpTo: false, requeue: true }]);
  });

  it('records every exchange it declared, with its type', async () => {
    const fake = makeFakeAmqpChannel();

    await channelOf(fake).assertExchange('entifix.events', 'topic', {
      durable: true,
    });
    await channelOf(fake).assertExchange('entifix.events.dlx', 'direct', {
      durable: true,
    });

    expect(fake.exchanges).toEqual([
      { exchange: 'entifix.events', type: 'topic', options: { durable: true } },
      {
        exchange: 'entifix.events.dlx',
        type: 'direct',
        options: { durable: true },
      },
    ]);
  });

  it('records every queue it declared, with the arguments that are its policy', async () => {
    const fake = makeFakeAmqpChannel();
    const args = {
      'x-queue-type': 'quorum',
      'x-delivery-limit': 5,
      'x-dead-letter-exchange': 'entifix.events.dlx',
    };

    await channelOf(fake).assertQueue('slice.event', {
      durable: true,
      arguments: args,
    });
    // A server-named queue still records under the name the broker hands back.
    await channelOf(fake).assertQueue('', { exclusive: true });

    expect(fake.queues).toEqual([
      { queue: 'slice.event', options: { durable: true, arguments: args } },
      { queue: 'amq.gen-fake', options: { exclusive: true } },
    ]);
  });

  it('closes', async () => {
    await expect(
      channelOf(makeFakeAmqpChannel()).close(),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      'publish',
      (channel: FakeChannel) => channel.publish('e', '', Buffer.from('{}')),
    ],
    ['prefetch', (channel: FakeChannel) => channel.prefetch(1)],
    [
      'assertExchange',
      (channel: FakeChannel) => channel.assertExchange('e', 'topic'),
    ],
    ['assertQueue', (channel: FakeChannel) => channel.assertQueue('q')],
    ['bindQueue', (channel: FakeChannel) => channel.bindQueue('q', 'e', '#')],
    [
      'consume',
      (channel: FakeChannel) => channel.consume('q', () => undefined),
    ],
    ['close', (channel: FakeChannel) => channel.close()],
  ])('fails %s once told to fail', async (_label, run) => {
    const fake = makeFakeAmqpChannel();
    fake.failWith(new Error('channel closed'));

    await expect(async () => run(channelOf(fake))).rejects.toThrow(
      'channel closed',
    );
  });
});

// The adapter's filter translator emits these, so the fake has to evaluate the
// same operator vocabulary or a translated query would silently match nothing.
describe('makeFakeMongoDb query evaluation', () => {
  const rows = [
    { id: 'w-1', name: 'Alpha', size: 10 },
    { id: 'w-2', name: 'Beta', size: 20 },
    { id: 'w-3', name: 'Gamma', size: 30 },
  ];

  const matching = async (query: Record<string, unknown>) => {
    const fake = makeFakeMongoDb({ widget: rows });
    const found = await collectionOf(fake, 'widget').find(query).toArray();
    return found.map(doc => doc['id']);
  };

  it.each([
    ['$eq', { size: { $eq: 20 } }, ['w-2']],
    ['$ne', { size: { $ne: 20 } }, ['w-1', 'w-3']],
    ['$gt', { size: { $gt: 20 } }, ['w-3']],
    ['$gte', { size: { $gte: 20 } }, ['w-2', 'w-3']],
    ['$lt', { size: { $lt: 20 } }, ['w-1']],
    ['$lte', { size: { $lte: 20 } }, ['w-1', 'w-2']],
    ['$in', { id: { $in: ['w-1', 'w-3'] } }, ['w-1', 'w-3']],
    ['$nin', { id: { $nin: ['w-1'] } }, ['w-2', 'w-3']],
    ['$not', { size: { $not: { $gte: 20 } } }, ['w-1']],
    ['a range', { size: { $gte: 20, $lte: 20 } }, ['w-2']],
    ['a bare value', { name: 'Beta' }, ['w-2']],
    ['$and', { $and: [{ size: { $gte: 20 } }, { name: 'Beta' }] }, ['w-2']],
    ['$or', { $or: [{ name: 'Alpha' }, { name: 'Gamma' }] }, ['w-1', 'w-3']],
    ['an empty query', {}, ['w-1', 'w-2', 'w-3']],
  ])('evaluates %s', async (_label, query, expected) => {
    expect(await matching(query)).toEqual(expected);
  });

  it('evaluates a case-insensitive $regex', async () => {
    expect(await matching({ name: { $regex: 'et', $options: 'i' } })).toEqual([
      'w-2',
    ]);
    expect(await matching({ name: { $regex: 'ET' } })).toEqual([]);
  });

  // An unsupported operator throws rather than matching nothing: a silently
  // empty result would look like a legitimately empty collection.
  it('refuses an operator it does not implement', async () => {
    await expect(matching({ size: { $mod: [2, 0] } })).rejects.toThrow(
      /unsupported operator "\$mod"/,
    );
  });
});

// The fake's comparison has to agree with Mongo's, or a sorted page would come
// back in a different order than the adapter produces against a real server.
describe('makeFakeMongoDb value comparison', () => {
  const ordered = async (documents: Record<string, unknown>[]) => {
    const fake = makeFakeMongoDb({ widget: documents });
    const found = await collectionOf(fake, 'widget')
      .find({})
      .sort({ size: 1 })
      .toArray();
    return found.map(doc => doc['id']);
  };

  it('sorts an absent value first', async () => {
    expect(await ordered([{ id: 'w-1', size: 10 }, { id: 'w-2' }])).toEqual([
      'w-2',
      'w-1',
    ]);
  });

  it('sorts an absent value first whichever side it arrives on', async () => {
    expect(await ordered([{ id: 'w-1' }, { id: 'w-2', size: 10 }])).toEqual([
      'w-1',
      'w-2',
    ]);
  });

  it('treats two absent values as equal', async () => {
    expect(await ordered([{ id: 'w-1' }, { id: 'w-2' }])).toEqual([
      'w-1',
      'w-2',
    ]);
  });

  it('sorts dates chronologically', async () => {
    expect(
      await ordered([
        { id: 'w-1', size: new Date('2026-07-20') },
        { id: 'w-2', size: new Date('2026-01-01') },
      ]),
    ).toEqual(['w-2', 'w-1']);
  });

  it('falls back to a lexicographic comparison', async () => {
    expect(
      await ordered([
        { id: 'w-1', size: 'beta' },
        { id: 'w-2', size: 'alpha' },
      ]),
    ).toEqual(['w-2', 'w-1']);
  });
});

describe('makeFakeSqlClient', () => {
  /** The fake only implements the constructor surface the adapters use. */
  const clientOf = (fake: ReturnType<typeof makeFakeSqlClient>) =>
    fake.client as SqlClient.SqlClient;

  it('compiles to the Postgres dialect: $n placeholders, quoted identifiers', async () => {
    const fake = makeFakeSqlClient();
    const sql = clientOf(fake);

    await Effect.runPromise(
      sql`SELECT * FROM ${sql('widget')} WHERE ${sql('id')} = ${'w-1'}`,
    );

    expect(fake.lastExecution).toEqual({
      sql: 'SELECT * FROM "widget" WHERE "id" = $1',
      params: ['w-1'],
    });
  });

  it('answers with the rows registered for a matching statement', async () => {
    const fake = makeFakeSqlClient([
      { match: 'SELECT', rows: [{ id: 'w-1' }] },
    ]);
    const sql = clientOf(fake);

    const rows = await Effect.runPromise(sql`SELECT 1`);

    expect(rows).toEqual([{ id: 'w-1' }]);
  });

  it('answers with nothing when no response matches', async () => {
    const fake = makeFakeSqlClient([{ match: 'DELETE', rows: [{ id: 'x' }] }]);
    const sql = clientOf(fake);

    expect(await Effect.runPromise(sql`SELECT 1`)).toEqual([]);
  });

  it('lets a later registration override an earlier one', async () => {
    const fake = makeFakeSqlClient([
      { match: 'SELECT', rows: [{ id: 'first' }] },
    ]);
    fake.respondTo('SELECT', [{ id: 'second' }]);
    const sql = clientOf(fake);

    expect(await Effect.runPromise(sql`SELECT 1`)).toEqual([{ id: 'second' }]);
  });

  it('fails every statement after failWith', async () => {
    const fake = makeFakeSqlClient();
    fake.failWith('connection terminated');
    const sql = clientOf(fake);

    const exit = await Effect.runPromiseExit(sql`SELECT 1`);

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('fails only the statements matching failOn', async () => {
    const fake = makeFakeSqlClient();
    fake.failOn('COUNT', 'count exploded');
    const sql = clientOf(fake);

    expect(Exit.isSuccess(await Effect.runPromiseExit(sql`SELECT 1`))).toBe(
      true,
    );
    expect(
      Exit.isFailure(await Effect.runPromiseExit(sql`SELECT COUNT(*) FROM x`)),
    ).toBe(true);
  });

  it('records every statement in order', async () => {
    const fake = makeFakeSqlClient();
    const sql = clientOf(fake);

    await Effect.runPromise(sql`SELECT 1`);
    await Effect.runPromise(sql`DELETE FROM ${sql('widget')}`);

    expect(fake.executions.map(execution => execution.sql)).toEqual([
      'SELECT 1',
      'DELETE FROM "widget"',
    ]);
  });

  it('has no last execution before anything ran', () => {
    expect(makeFakeSqlClient().lastExecution).toBeUndefined();
  });

  it('serves unprepared and raw statements from the same recording', async () => {
    const fake = makeFakeSqlClient([{ match: 'SELECT', rows: [{ n: 1 }] }]);
    const sql = clientOf(fake);

    expect(await Effect.runPromise(sql`SELECT 1`.unprepared)).toEqual([
      { n: 1 },
    ]);
    await Effect.runPromise(sql`SELECT 1`.raw);

    expect(fake.executions).toHaveLength(2);
  });

  it('throws rather than silently answering an unimplemented call', async () => {
    const fake = makeFakeSqlClient();
    const sql = clientOf(fake);

    // A fake that returned `[]` for `.values` would let a spec pass on a query
    // that never happened.
    await expect(Effect.runPromise(sql`SELECT 1`.values)).rejects.toThrow(
      /not implemented/,
    );
    await expect(
      Effect.runPromise(Stream.runCollect(sql`SELECT 1`.stream)),
    ).rejects.toThrow(/not implemented/);
  });

  it('throws for the compiler features no adapter uses', () => {
    const fake = makeFakeSqlClient();
    const sql = clientOf(fake);

    expect(() =>
      sql`UPDATE x SET ${sql.updateValues([{ a: 1 }], 'v')}`.compile(),
    ).toThrow(/updateValues is not implemented/);

    const custom = Statement.custom('PgJson')({ a: 1 }, undefined, undefined);
    expect(() => sql`SELECT ${custom}`.compile()).toThrow(
      /custom segments is not implemented/,
    );
  });
});

/**
 * The ledger half of the driver: the operators a fold and a conditional write
 * need, the unique index that keeps the fold singular, and the session that
 * makes the two halves of a write one thing.
 *
 * These are exercised through `apps/stock-service`, whose e2e `mock` profile
 * runs the real routes over this fake — so an operator that silently did
 * nothing here would report a green suite for a ledger that never moved
 * ([ADR 0010](../../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 */
describe('makeFakeMongoDb ledger operations', () => {
  const stocked = () =>
    makeFakeMongoDb({
      'stock-item': [{ id: 'i-1', offeringId: 'o-1', onHand: 10, reserved: 4 }],
    });

  describe('insertOne', () => {
    it('appends a copy and reports the id', async () => {
      const fake = makeFakeMongoDb();
      const incoming = { id: 'm-1', quantity: 5 };

      const result = await collectionOf(fake, 'stock-movement').insertOne(
        incoming,
      );
      incoming.quantity = 999;

      expect(result).toEqual({ acknowledged: true, insertedId: 'm-1' });
      expect(fake.read('stock-movement')).toEqual([{ id: 'm-1', quantity: 5 }]);
    });

    it('reports a null id for a document that carries none', async () => {
      const result = await collectionOf(makeFakeMongoDb(), 'thing').insertOne({
        name: 'anonymous',
      });

      expect(result.insertedId).toBeNull();
    });
  });

  describe('$inc', () => {
    it('increments an existing field', async () => {
      const fake = stocked();

      const result = await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-1' },
        { $inc: { onHand: 7 } },
      );

      expect(result.matchedCount).toBe(1);
      expect(fake.read('stock-item')[0]['onHand']).toBe(17);
    });

    it('decrements, because a movement is signed', async () => {
      const fake = stocked();

      await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-1' },
        { $inc: { onHand: -3 } },
      );

      expect(fake.read('stock-item')[0]['onHand']).toBe(7);
    });

    it('creates an absent field at the increment value', async () => {
      const fake = makeFakeMongoDb({ 'stock-item': [{ offeringId: 'o-1' }] });

      await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-1' },
        { $inc: { onHand: 4 } },
      );

      expect(fake.read('stock-item')[0]['onHand']).toBe(4);
    });
  });

  describe('upsert with $setOnInsert', () => {
    it('inserts from the query equality fields plus $setOnInsert, with $inc applied', async () => {
      const fake = makeFakeMongoDb();

      const result = await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-9' },
        { $inc: { onHand: 6 }, $setOnInsert: { id: 'i-9', reserved: 0 } },
        { upsert: true },
      );

      expect(result).toEqual({
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
      });
      expect(fake.read('stock-item')).toEqual([
        { offeringId: 'o-9', id: 'i-9', reserved: 0, onHand: 6 },
      ]);
    });

    it('upserts with no $setOnInsert at all, creating the field at the increment', async () => {
      const fake = makeFakeMongoDb();

      await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-9' },
        { $inc: { onHand: 3 } },
        { upsert: true },
      );

      expect(fake.read('stock-item')).toEqual([
        { offeringId: 'o-9', onHand: 3 },
      ]);
    });

    it('takes the update branch when the document exists, ignoring $setOnInsert', async () => {
      const fake = stocked();

      const result = await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-1' },
        { $inc: { onHand: 1 }, $setOnInsert: { id: 'other', reserved: 0 } },
        { upsert: true },
      );

      expect(result.matchedCount).toBe(1);
      expect(fake.read('stock-item')[0]).toEqual({
        id: 'i-1',
        offeringId: 'o-1',
        onHand: 11,
        reserved: 4,
      });
    });

    it('matches nothing and inserts nothing without upsert', async () => {
      const fake = makeFakeMongoDb();

      const result = await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-9' },
        { $inc: { onHand: 6 } },
      );

      expect(result).toEqual({
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      });
      expect(fake.read('stock-item')).toEqual([]);
    });

    it('does not seed an operator condition into the upserted document', async () => {
      const fake = makeFakeMongoDb();

      await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-9', onHand: { $gte: 1 } },
        { $setOnInsert: { id: 'i-9' } },
        { upsert: true },
      );

      expect(fake.read('stock-item')[0]).toEqual({
        offeringId: 'o-9',
        id: 'i-9',
      });
    });

    it('refuses an update whose $setOnInsert and $inc name one field', async () => {
      await expect(
        collectionOf(makeFakeMongoDb(), 'stock-item').updateOne(
          { offeringId: 'o-9' },
          { $inc: { onHand: 1 }, $setOnInsert: { onHand: 0 } },
          { upsert: true },
        ),
      ).rejects.toThrow(/conflicting paths/);
    });
  });

  describe('$expr', () => {
    const availability = (quantity: number) => ({
      $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] },
    });

    it('matches when the two fields leave enough', async () => {
      const found = await collectionOf(stocked(), 'stock-item')
        .find(availability(6))
        .toArray();

      expect(found).toHaveLength(1);
    });

    it('does not match when they do not — which is the out-of-stock answer', async () => {
      const found = await collectionOf(stocked(), 'stock-item')
        .find(availability(7))
        .toArray();

      expect(found).toEqual([]);
    });

    it.each([
      ['$add', { $expr: { $gte: [{ $add: ['$onHand', '$reserved'] }, 14] } }],
      ['$gt', { $expr: { $gt: ['$onHand', 9] } }],
      ['$lte', { $expr: { $lte: ['$reserved', 4] } }],
      ['$lt', { $expr: { $lt: ['$reserved', 5] } }],
      ['$eq', { $expr: { $eq: ['$offeringId', 'o-1'] } }],
    ])('evaluates %s', async (_name, query) => {
      const found = await collectionOf(stocked(), 'stock-item')
        .find(query)
        .toArray();

      expect(found).toHaveLength(1);
    });

    it('rejects an operator it cannot evaluate rather than guessing', async () => {
      await expect(
        collectionOf(stocked(), 'stock-item')
          .find({ $expr: { $multiply: ['$onHand', 2] } })
          .toArray(),
      ).rejects.toThrow(/unsupported \$expr operator "\$multiply"/);
    });

    it('rejects a node carrying more than one operator', async () => {
      await expect(
        collectionOf(stocked(), 'stock-item')
          .find({ $expr: { $gte: ['$onHand', 1], $lte: ['$onHand', 5] } })
          .toArray(),
      ).rejects.toThrow(/exactly one operator/);
    });
  });

  describe('a unique index', () => {
    const indexed = async () => {
      const fake = stocked();
      await collectionOf(fake, 'stock-item').createIndex(
        { offeringId: 1 },
        { unique: true, name: 'offeringId_1' },
      );
      return fake;
    };

    it('refuses a second document for the same key, with code 11000', async () => {
      const fake = await indexed();

      await expect(
        collectionOf(fake, 'stock-item').insertOne({
          id: 'i-2',
          offeringId: 'o-1',
        }),
      ).rejects.toMatchObject({ code: 11000 });
      expect(fake.read('stock-item')).toHaveLength(1);
    });

    it('refuses the insert branch of an upsert for the same key', async () => {
      const fake = await indexed();
      // A filter that finds nothing, so the upsert takes its insert branch —
      // which is the shape two concurrent upserts produce against a real
      // server, and the reason the index exists at all.
      await expect(
        collectionOf(fake, 'stock-item').updateOne(
          { offeringId: 'o-1', onHand: { $gte: 1000 } },
          { $inc: { onHand: 1 }, $setOnInsert: { offeringId: 'o-1' } },
          { upsert: true },
        ),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('lets a document keep its own key on update', async () => {
      const fake = await indexed();

      await collectionOf(fake, 'stock-item').updateOne(
        { offeringId: 'o-1' },
        { $inc: { onHand: 1 } },
      );

      expect(fake.read('stock-item')[0]['onHand']).toBe(11);
    });

    it('is idempotent, because a tenant handle ensures it per request', async () => {
      const fake = await indexed();
      await collectionOf(fake, 'stock-item').createIndex(
        { offeringId: 1 },
        { unique: true },
      );

      await expect(
        collectionOf(fake, 'stock-item').insertOne({ offeringId: 'o-1' }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('ignores a document missing the indexed field', async () => {
      const fake = await indexed();

      await collectionOf(fake, 'stock-item').insertOne({ id: 'i-2' });

      expect(fake.read('stock-item')).toHaveLength(2);
    });

    it('enforces itself on insertMany', async () => {
      const fake = await indexed();

      await expect(
        collectionOf(fake, 'stock-item').insertMany([{ offeringId: 'o-1' }]),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('does not enforce a non-unique index', async () => {
      const fake = stocked();
      await collectionOf(fake, 'stock-item').createIndex({ offeringId: 1 });

      await collectionOf(fake, 'stock-item').insertOne({ offeringId: 'o-1' });

      expect(fake.read('stock-item')).toHaveLength(2);
    });
  });

  describe('a session', () => {
    it('commits every write a body makes', async () => {
      const fake = stocked();
      const session = fake.startSession();

      await session.withTransaction(async () => {
        await collectionOf(fake, 'stock-item').updateOne(
          { offeringId: 'o-1' },
          { $inc: { reserved: 2 } },
        );
        await collectionOf(fake, 'reservation').insertOne({ id: 'r-1' });
      });

      expect(fake.read('stock-item')[0]['reserved']).toBe(6);
      expect(fake.read('reservation')).toHaveLength(1);
    });

    it('rolls the whole store back when the body throws', async () => {
      const fake = stocked();
      const session = fake.startSession();

      await expect(
        session.withTransaction(async () => {
          await collectionOf(fake, 'stock-item').updateOne(
            { offeringId: 'o-1' },
            { $inc: { reserved: 2 } },
          );
          throw new Error('insufficient stock');
        }),
      ).rejects.toThrow('insufficient stock');

      // The counter moved and was put back: a half-applied hold is exactly what
      // the transaction exists to rule out.
      expect(fake.read('stock-item')[0]['reserved']).toBe(4);
      expect(fake.read('reservation')).toEqual([]);
    });

    it('returns what the body returned', async () => {
      const session = makeFakeMongoDb().startSession();

      expect(await session.withTransaction(async () => 'committed')).toBe(
        'committed',
      );
    });

    it('ends', async () => {
      const session = makeFakeMongoDb().startSession();

      expect(session.hasEnded).toBe(false);
      await session.endSession();
      expect(session.hasEnded).toBe(true);
    });
  });
});

/**
 * The three operations a two-message join and a batch claim need.
 *
 * They live here rather than beside the service that wanted them because the
 * fake is the fleet's, not settlement's: the next slice that joins two events
 * or claims a batch of rows needs exactly these.
 */
describe('makeFakeMongoDb claim operations', () => {
  it('matches a field that is absent with $exists: false', async () => {
    // The predicate a settlement ledger keys "unpaid" on. `undefined` is what a
    // document without the field reads as, so the fake has to distinguish
    // absence from any value rather than from a falsy one.
    const fake = makeFakeMongoDb({
      entry: [
        { id: 'e-1', runId: 'run-1' },
        { id: 'e-2' },
        { id: 'e-3', runId: '' },
      ],
    });

    const unsettled = await collectionOf(fake, 'entry')
      .find({ runId: { $exists: false } })
      .toArray();

    expect(unsettled.map(row => row['id'])).toEqual(['e-2']);
  });

  it('matches a field that is present with $exists: true', async () => {
    const fake = makeFakeMongoDb({
      entry: [{ id: 'e-1', runId: 'run-1' }, { id: 'e-2' }],
    });

    const settled = await collectionOf(fake, 'entry')
      .find({ runId: { $exists: true } })
      .toArray();

    expect(settled.map(row => row['id'])).toEqual(['e-1']);
  });

  it('updateMany sets every match and counts them', async () => {
    const fake = makeFakeMongoDb({
      entry: [{ id: 'e-1' }, { id: 'e-2' }, { id: 'e-3', runId: 'run-0' }],
    });

    const result = await collectionOf(fake, 'entry').updateMany(
      { runId: { $exists: false } },
      { $set: { runId: 'run-1' } },
    );

    expect(result).toEqual({ matchedCount: 2, modifiedCount: 2 });
    expect(fake.read('entry').map(row => row['runId'])).toEqual([
      'run-1',
      'run-1',
      'run-0',
    ]);
  });

  // The count is what a caller branches on: a run that claims nothing has lost
  // the race to another replica and must settle itself cancelled. A fake that
  // reported a fixed count would make the loser behave like the winner.
  it('updateMany reports zero when nothing matches', async () => {
    const fake = makeFakeMongoDb({ entry: [{ id: 'e-1', runId: 'run-0' }] });

    expect(
      await collectionOf(fake, 'entry').updateMany(
        { runId: { $exists: false } },
        { $set: { runId: 'run-1' } },
      ),
    ).toEqual({ matchedCount: 0, modifiedCount: 0 });
  });

  it('updateMany with no $set counts the matches and changes nothing', async () => {
    const fake = makeFakeMongoDb({ entry: [{ id: 'e-1' }, { id: 'e-2' }] });

    expect(await collectionOf(fake, 'entry').updateMany({}, {})).toEqual({
      matchedCount: 2,
      modifiedCount: 2,
    });
    expect(fake.read('entry')).toEqual([{ id: 'e-1' }, { id: 'e-2' }]);
  });

  it('updateMany refuses an operator it does not apply', async () => {
    const fake = makeFakeMongoDb({ entry: [{ id: 'e-1' }] });

    await expect(
      collectionOf(fake, 'entry').updateMany({ id: 'e-1' }, {
        $inc: { total: 1 },
      } as { $set?: Record<string, unknown> }),
    ).rejects.toThrow('does not implement $inc');
  });

  it('updateMany enforces a unique index', async () => {
    const fake = makeFakeMongoDb({
      entry: [
        { id: 'e-1', orderId: 'o-1' },
        { id: 'e-2', orderId: 'o-2' },
      ],
    });
    await collectionOf(fake, 'entry').createIndex(
      { orderId: 1 },
      { unique: true },
    );

    await expect(
      collectionOf(fake, 'entry').updateMany({}, { $set: { orderId: 'o-1' } }),
    ).rejects.toThrow();
  });

  it('findOneAndUpdate returns the merged document after an upsert', async () => {
    // The question a two-message join asks: not "did it write?" but "is the
    // pair complete now?", which only the after state answers.
    const fake = makeFakeMongoDb();

    const merged = await collectionOf(fake, 'pending').findOneAndUpdate(
      { orderId: 'o-1' },
      { $set: { decidedAt: 'now' }, $setOnInsert: { folded: false } },
      { upsert: true, returnDocument: 'after' },
    );

    expect(merged).toEqual({
      orderId: 'o-1',
      decidedAt: 'now',
      folded: false,
    });
  });

  it('findOneAndUpdate merges a second half onto an existing document', async () => {
    const fake = makeFakeMongoDb({
      pending: [{ orderId: 'o-1', folded: false, decidedAt: 'now' }],
    });

    const merged = await collectionOf(fake, 'pending').findOneAndUpdate(
      { orderId: 'o-1' },
      { $set: { lines: 2 } },
      { upsert: true, returnDocument: 'after' },
    );

    expect(merged).toEqual({
      orderId: 'o-1',
      folded: false,
      decidedAt: 'now',
      lines: 2,
    });
  });

  it('findOneAndUpdate returns null when nothing matched and no upsert', async () => {
    const fake = makeFakeMongoDb({ pending: [] });

    expect(
      await collectionOf(fake, 'pending').findOneAndUpdate(
        { orderId: 'o-1' },
        { $set: { decidedAt: 'now' } },
      ),
    ).toBeNull();
  });

  it('findOneAndUpdate defaults to returning the after state', async () => {
    const fake = makeFakeMongoDb({ pending: [{ orderId: 'o-1', half: 1 }] });

    expect(
      await collectionOf(fake, 'pending').findOneAndUpdate(
        { orderId: 'o-1' },
        { $set: { half: 2 } },
      ),
    ).toEqual({ orderId: 'o-1', half: 2 });
  });

  it('findOneAndUpdate refuses to return the before state', async () => {
    const fake = makeFakeMongoDb({ pending: [{ orderId: 'o-1' }] });

    await expect(
      collectionOf(fake, 'pending').findOneAndUpdate(
        { orderId: 'o-1' },
        { $set: { half: 1 } },
        { returnDocument: 'before' },
      ),
    ).rejects.toThrow('returnDocument');
  });

  it('findOneAndUpdate finds a row its operator condition no longer matches', async () => {
    // After an upsert the query's operator conditions may not hold of the row
    // just inserted, so it is found by the equality fields the upsert seeded it
    // with — which are what identify it.
    const fake = makeFakeMongoDb();

    const merged = await collectionOf(fake, 'pending').findOneAndUpdate(
      { orderId: 'o-1', folded: { $exists: false } },
      { $set: { folded: true } },
      { upsert: true, returnDocument: 'after' },
    );

    expect(merged).toEqual({ orderId: 'o-1', folded: true });
  });
});
