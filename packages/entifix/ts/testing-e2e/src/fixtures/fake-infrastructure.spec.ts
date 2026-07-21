import { AmqpChannelTag } from '@r10c/entifix-ts-amqp-client';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
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

  it('provides an amqp channel that records what was published', async () => {
    const { driver, layer } = fakeAmqpLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const channel = yield* AmqpChannelTag;
        channel.publish(
          'transactions',
          '',
          Buffer.from(JSON.stringify({ hello: 'world' })),
        );
      }).pipe(Effect.provide(layer)),
    );

    expect(driver.published).toEqual([
      { exchange: 'transactions', body: { hello: 'world' } },
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
