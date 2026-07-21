import { describe, expect, it } from 'vitest';

import { makeFakeAmqpChannel } from './fake-amqp';
import { makeFakeMongoDb } from './fake-mongo';
import { makeFakeRedis } from './fake-redis';

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
  replaceOne(
    query: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; upsertedCount: number }>;
  deleteOne(query: Record<string, unknown>): Promise<{ deletedCount: number }>;
  createIndex(spec: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
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

    await collectionOf(fake, 'widget').replaceOne({ id: 'w-1' }, { id: 'w-1', name: 'x' });

    expect(documents[0]).toEqual({ id: 'w-1' });
  });

  it('serves an unknown collection as empty', async () => {
    expect(await collectionOf(makeFakeMongoDb(), 'absent').find().toArray()).toEqual([]);
  });

  describe('find', () => {
    it('matches on equality', async () => {
      const found = await collectionOf(seeded(), 'widget').find({ id: 'w-2' }).toArray();

      expect(found.map((doc) => doc['name'])).toEqual(['Beta']);
    });

    it('sorts ascending and descending', async () => {
      const collection = collectionOf(seeded(), 'widget');

      const ascending = await collection.find({}).sort({ size: 1 }).toArray();
      const descending = await collectionOf(seeded(), 'widget')
        .find({})
        .sort({ size: -1 })
        .toArray();

      expect(ascending.map((doc) => doc['size'])).toEqual([10, 20, 30]);
      expect(descending.map((doc) => doc['size'])).toEqual([30, 20, 10]);
    });

    it('pages with skip and limit', async () => {
      const found = await collectionOf(seeded(), 'widget')
        .find({})
        .sort({ size: 1 })
        .skip(1)
        .limit(1)
        .toArray();

      expect(found.map((doc) => doc['size'])).toEqual([20]);
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

      const result = await collectionOf(fake, 'widget').replaceOne({ id: 'w-9' }, { id: 'w-9' });

      expect(result).toEqual({ matchedCount: 0, upsertedCount: 0 });
      expect(fake.read('widget')).toHaveLength(3);
    });

    it('deleteOne removes a match and reports a miss', async () => {
      const fake = seeded();
      const collection = collectionOf(fake, 'widget');

      expect(await collection.deleteOne({ id: 'w-1' })).toEqual({ deletedCount: 1 });
      expect(await collection.deleteOne({ id: 'w-1' })).toEqual({ deletedCount: 0 });
      expect(fake.read('widget')).toHaveLength(2);
    });

    it('createIndex records what was asked for', async () => {
      const fake = seeded();

      await collectionOf(fake, 'widget').createIndex({ id: 1 }, { unique: true });

      expect(fake.operations.at(-1)).toEqual({ collection: 'widget', op: 'createIndex' });
    });
  });

  describe('failures', () => {
    it('failWith rejects every operation', async () => {
      const fake = seeded();
      fake.failWith(new Error('connection refused'));

      await expect(collectionOf(fake, 'widget').find({}).toArray()).rejects.toThrow(
        'connection refused',
      );
    });

    // A blanket failure never gets past the first call, so the later error
    // branches are only reachable per-operation.
    it('failOn rejects only the named operation', async () => {
      const fake = seeded();
      fake.failOn('countDocuments', new Error('connection refused'));
      const collection = collectionOf(fake, 'widget');

      await expect(collection.find({}).toArray()).resolves.toHaveLength(3);
      await expect(collection.countDocuments({})).rejects.toThrow('connection refused');
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
  incr(key: string): Promise<number>;
  eval(script: string, numKeys: number, key: string, token: string): Promise<number>;
  quit(): Promise<string>;
}

describe('makeFakeRedis', () => {
  const client = (fake: ReturnType<typeof makeFakeRedis>) => fake.redis as FakeRedisClient;

  // `NX` is what makes acquisition atomic across instances, so honouring it is
  // the whole reason this fake exists rather than a plain Map.
  it('refuses to overwrite a held key under NX', async () => {
    const fake = makeFakeRedis();
    await client(fake).set('lock', 'mine', 'PX', 1000, 'NX');

    expect(await client(fake).set('lock', 'theirs', 'PX', 1000, 'NX')).toBeNull();
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
  assertExchange(exchange: string): Promise<{ exchange: string }>;
  assertQueue(queue: string): Promise<{ queue: string }>;
  bindQueue(): Promise<void>;
  consume(
    queue: string,
    handler: (message: { content: Buffer } | null) => void,
  ): Promise<{ consumerTag: string }>;
  ack(message: { content: Buffer }): void;
  nack(message: { content: Buffer }): void;
  close(): Promise<void>;
}

describe('makeFakeAmqpChannel', () => {
  const channelOf = (fake: ReturnType<typeof makeFakeAmqpChannel>) =>
    fake.channel as FakeChannel;

  it('records what was published, decoded', () => {
    const fake = makeFakeAmqpChannel();

    channelOf(fake).publish('events', '', Buffer.from(JSON.stringify({ a: 1 })));

    expect(fake.published).toEqual([{ exchange: 'events', body: { a: 1 } }]);
  });

  // The transaction-manager's event fold depends on `prefetch(1)`: without it,
  // accepted and completed events race into duplicate records.
  it('records the prefetch the consumer asked for', async () => {
    const fake = makeFakeAmqpChannel();

    await channelOf(fake).prefetch(1);

    expect(fake.prefetchCount).toBe(1);
  });

  it('asserts an exchange and a named queue', async () => {
    const channel = channelOf(makeFakeAmqpChannel());

    expect(await channel.assertExchange('events')).toEqual({ exchange: 'events' });
    expect(await channel.assertQueue('work')).toEqual({ queue: 'work' });
  });

  // An empty queue name means "give me an exclusive generated one", which the
  // fanout subscriber relies on.
  it('generates a queue name for the empty string', async () => {
    expect(await channelOf(makeFakeAmqpChannel()).assertQueue('')).toEqual({
      queue: 'amq.gen-fake',
    });
  });

  it('binds a queue', async () => {
    await expect(channelOf(makeFakeAmqpChannel()).bindQueue()).resolves.toBeUndefined();
  });

  it('delivers to whatever subscribed', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).consume('work', (message) => {
      received.push(JSON.parse(message?.content.toString() ?? 'null'));
    });

    await fake.deliver({ a: 1 });

    expect(received).toEqual([{ a: 1 }]);
  });

  it('delivers a raw payload, so a malformed message can be tested', async () => {
    const fake = makeFakeAmqpChannel();
    const received: string[] = [];
    await channelOf(fake).consume('work', (message) => {
      received.push(message?.content.toString() ?? '');
    });

    await fake.deliverRaw('not json');

    expect(received).toEqual(['not json']);
  });

  // A null delivery is how amqplib signals the consumer was cancelled.
  it('delivers a cancellation', async () => {
    const fake = makeFakeAmqpChannel();
    const received: unknown[] = [];
    await channelOf(fake).consume('work', (message) => received.push(message));

    await fake.deliverCancellation();

    expect(received).toEqual([null]);
  });

  it.each([
    ['a delivery', (fake: ReturnType<typeof makeFakeAmqpChannel>) => fake.deliver({ a: 1 })],
    [
      'a cancellation',
      (fake: ReturnType<typeof makeFakeAmqpChannel>) => fake.deliverCancellation(),
    ],
  ])('refuses %s before anything subscribed', async (_label, deliver) => {
    await expect(deliver(makeFakeAmqpChannel())).rejects.toThrow(/nothing subscribed/);
  });

  it('records acks and nacks', () => {
    const fake = makeFakeAmqpChannel();
    const message = { content: Buffer.from('{}') };

    channelOf(fake).ack(message);
    channelOf(fake).nack(message);

    expect(fake.acked).toEqual([message]);
    expect(fake.nacked).toEqual([message]);
  });

  it('closes', async () => {
    await expect(channelOf(makeFakeAmqpChannel()).close()).resolves.toBeUndefined();
  });

  it.each([
    ['publish', (channel: FakeChannel) => channel.publish('e', '', Buffer.from('{}'))],
    ['prefetch', (channel: FakeChannel) => channel.prefetch(1)],
    ['assertExchange', (channel: FakeChannel) => channel.assertExchange('e')],
    ['assertQueue', (channel: FakeChannel) => channel.assertQueue('q')],
    ['bindQueue', (channel: FakeChannel) => channel.bindQueue()],
    ['consume', (channel: FakeChannel) => channel.consume('q', () => undefined)],
    ['close', (channel: FakeChannel) => channel.close()],
  ])('fails %s once told to fail', async (_label, run) => {
    const fake = makeFakeAmqpChannel();
    fake.failWith(new Error('channel closed'));

    await expect(async () => run(channelOf(fake))).rejects.toThrow('channel closed');
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
    return found.map((doc) => doc['id']);
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
    expect(await matching({ name: { $regex: 'et', $options: 'i' } })).toEqual(['w-2']);
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
    return found.map((doc) => doc['id']);
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
    expect(await ordered([{ id: 'w-1' }, { id: 'w-2' }])).toEqual(['w-1', 'w-2']);
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
      await ordered([{ id: 'w-1', size: 'beta' }, { id: 'w-2', size: 'alpha' }]),
    ).toEqual(['w-2', 'w-1']);
  });
});
