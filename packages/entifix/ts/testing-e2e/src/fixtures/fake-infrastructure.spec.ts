import { AmqpChannelTag } from '@r10c/entifix-ts-amqp-client';
import {
  ConfigurationRepositoryTag,
  TenantDatabaseResolverTag,
} from '@r10c/entifix-ts-business';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { RedisTag } from '@r10c/entifix-ts-redis-client';
import { Effect } from 'effect';

import {
  fakeAmqpLayer,
  fakeConfigurationLayer,
  fakeMongoLayer,
  fakeRedisLayer,
} from './fake-infrastructure';

describe('the fake infrastructure layers', () => {
  it('provides a mongo database seeded per collection', async () => {
    const { driver, layer } = fakeMongoLayer({
      widget: [{ id: 'w1', name: 'Acme' }],
    });

    const documents = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* MongoDatabaseTag;
        return yield* Effect.promise(() =>
          db.collection('widget').find({}).toArray(),
        );
      }).pipe(Effect.provide(layer)),
    );

    expect(documents).toMatchObject([{ id: 'w1', name: 'Acme' }]);
    expect(driver.read('widget')).toHaveLength(1);
  });

  it('provides the client and the tenant resolver from the same fake store', async () => {
    // A service composition root asks for three tags, not one: the shared `Db`,
    // the client (the pool, used to seed a tenant database), and the resolver a
    // tenant-plane route reads. All three must come from one fake, or a spec
    // would write through one and read through another.
    const { layer } = fakeMongoLayer({ widget: [{ id: 'w1', name: 'Acme' }] });

    const [viaClient, viaResolver] = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* MongoClientTag;
        const resolver = yield* TenantDatabaseResolverTag;
        const tenantDb = yield* resolver.forOrganization('any-organization');
        return [
          yield* Effect.promise(() =>
            client.db('ignored').collection('widget').find({}).toArray(),
          ),
          yield* Effect.promise(() =>
            (tenantDb as ReturnType<typeof client.db>)
              .collection('widget')
              .find({})
              .toArray(),
          ),
        ];
      }).pipe(Effect.provide(layer)),
    );

    expect(viaClient).toMatchObject([{ id: 'w1' }]);
    expect(viaResolver).toMatchObject([{ id: 'w1' }]);
  });

  it('resolves every organization to the one in-memory store', async () => {
    // The honest mock of db-per-organization: there is a single fake, so this
    // profile proves routing and guards, never physical isolation. Only a live
    // run against real Mongo can show two organizations' data actually apart.
    const { layer } = fakeMongoLayer({ widget: [{ id: 'w1' }] });

    const same = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* TenantDatabaseResolverTag;
        const a = yield* resolver.forOrganization('org-a');
        const b = yield* resolver.forOrganization('org-b');
        return a === b;
      }).pipe(Effect.provide(layer)),
    );

    expect(same).toBe(true);
  });

  // The seed is copied, so a spec that mutates a row cannot leak into the next.
  it('copies the rows it was seeded with', () => {
    const row = { id: 'w1', name: 'Acme' };
    const { driver } = fakeMongoLayer({ widget: [row] });

    driver.read('widget')[0]['name'] = 'changed';

    expect(row.name).toBe('Acme');
  });

  it('starts with no collections when given no seed', () => {
    expect(fakeMongoLayer().driver.read('widget')).toEqual([]);
  });

  it('provides a redis client the adapters can command', async () => {
    const { driver, layer } = fakeRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const redis = yield* RedisTag;
        yield* Effect.promise(() => redis.incr('sequence:widget'));
      }).pipe(Effect.provide(layer)),
    );

    expect(driver.read('sequence:widget')).toBe('1');
  });

  // Through `withChannel`, because that is how the adapter reaches a channel:
  // the tag carries a connector that reopens on demand, never a held channel.
  it('provides an amqp connector that records what was published', async () => {
    const { driver, layer } = fakeAmqpLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const connector = yield* AmqpChannelTag;
        yield* Effect.promise(() =>
          connector.withChannel(async channel => {
            channel.publish(
              'entifix.events',
              'widget.created',
              Buffer.from(JSON.stringify({ hello: 'world' })),
            );
          }),
        );
      }).pipe(Effect.provide(layer)),
    );

    expect(driver.published).toEqual([
      {
        exchange: 'entifix.events',
        routingKey: 'widget.created',
        body: { hello: 'world' },
      },
    ]);
  });

  it('registers a consumer against the fake channel', async () => {
    const { driver, layer } = fakeAmqpLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const connector = yield* AmqpChannelTag;
        yield* Effect.promise(() =>
          connector.addConsumer(async channel => {
            await channel.bindQueue('q', 'entifix.events', 'widget.*');
          }),
        );
      }).pipe(Effect.provide(layer)),
    );

    expect(driver.bindings).toEqual([
      { queue: 'q', exchange: 'entifix.events', pattern: 'widget.*' },
    ]);
  });

  it('provides the configuration a service would fetch at boot', async () => {
    const store = await Effect.runPromise(
      ConfigurationRepositoryTag.pipe(
        Effect.provide(
          fakeConfigurationLayer({
            mongo: [{ key: 'db', value: 'catalog' }],
          }),
        ),
      ),
    );

    expect(await Effect.runPromise(store.in('mongo').getString('db'))).toBe(
      'catalog',
    );
  });

  it('provides an empty configuration by default', async () => {
    const store = await Effect.runPromise(
      ConfigurationRepositoryTag.pipe(Effect.provide(fakeConfigurationLayer())),
    );

    expect(store).toBeDefined();
  });
});
