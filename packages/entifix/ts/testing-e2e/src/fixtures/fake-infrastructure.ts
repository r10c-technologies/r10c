import { AmqpChannelTag } from '@r10c/entifix-ts-amqp-client';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  type ConfigurationPlain,
  ConfigurationStoreInMemory,
} from '@r10c/entifix-ts-core';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { RedisTag } from '@r10c/entifix-ts-redis-client';
import {
  type FakeAmqpChannel,
  type FakeMongoDb,
  type FakeRedis,
  makeFakeAmqpChannel,
  makeFakeMongoDb,
  makeFakeRedis,
} from '@r10c/entifix-ts-testing-unit/drivers';
import { Layer } from 'effect';

import type { BackendRow } from './entity-backend';

/**
 * The driver fakes, wired as the Layers a service's composition root provides.
 *
 * These stand in for the *connections*, one level below the adapters — so the
 * Mongo repository, the Redis lock and sequence services and the AMQP event bus
 * all still run their own code. Substituting at the port level instead would
 * leave the filter translation, the `SET NX PX` and the envelope framing
 * unexecuted while the suite reported the service as covered.
 *
 * Each helper returns the fake alongside its Layer, because a spec usually
 * wants both: the Layer to boot with, the fake to seed, inspect or break.
 *
 * The casts are `never` on purpose: it keeps this package free of the mongodb,
 * ioredis and amqplib type packages while staying honest that these are not
 * real drivers.
 */

/**
 * A driver fake and the Layer that provides it. `TService` is the tag the Layer
 * satisfies, so `Effect.provide` actually discharges the requirement — typing
 * the Layer's output as `never` would leave every consumer still asking for it.
 */
export interface FakeInfrastructure<TDriver, TService> {
  readonly driver: TDriver;
  readonly layer: Layer.Layer<TService>;
}

export const fakeMongoLayer = (
  seed: Record<string, ReadonlyArray<BackendRow>> = {},
): FakeInfrastructure<FakeMongoDb, MongoDatabaseTag> => {
  const db = makeFakeMongoDb(
    Object.fromEntries(
      Object.entries(seed).map(([collection, rows]) => [
        collection,
        rows.map(row => ({ ...row })),
      ]),
    ),
  );

  return {
    driver: db,
    layer: Layer.succeed(MongoDatabaseTag, db.db as never),
  };
};

export const fakeRedisLayer = (): FakeInfrastructure<FakeRedis, RedisTag> => {
  const redis = makeFakeRedis();
  return {
    driver: redis,
    layer: Layer.succeed(RedisTag, redis.redis as never),
  };
};

export const fakeAmqpLayer = (): FakeInfrastructure<
  FakeAmqpChannel,
  AmqpChannelTag
> => {
  const channel = makeFakeAmqpChannel();
  return {
    driver: channel,
    layer: Layer.succeed(AmqpChannelTag, channel.channel as never),
  };
};

/**
 * The configuration a service would otherwise fetch from config-service at
 * boot, provided directly. The `mock` profile has no config-service, and going
 * through one would test the platform rather than the service under test.
 */
export const fakeConfigurationLayer = (
  plain: ConfigurationPlain = {},
): Layer.Layer<ConfigurationRepositoryTag> =>
  Layer.succeed(
    ConfigurationRepositoryTag,
    new ConfigurationStoreInMemory(plain),
  );
