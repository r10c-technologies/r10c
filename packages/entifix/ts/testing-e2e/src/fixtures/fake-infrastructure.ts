import {
  AmqpChannelTag,
  type AmqpConnector,
} from '@r10c/entifix-ts-amqp-client';
import {
  ConfigurationRepositoryTag,
  TenantDatabaseResolverTag,
} from '@r10c/entifix-ts-business';
import {
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@r10c/entifix-ts-core';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { RedisTag } from '@r10c/entifix-ts-redis-client';
import {
  type FakeAmqpChannel,
  type FakeMongoDb,
  type FakeRedis,
  makeFakeAmqpChannel,
  makeFakeMongoDb,
  makeFakeRedis,
} from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect, Layer } from 'effect';

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

/**
 * The Mongo fake, provided under all three tags a service may ask for: the
 * shared `Db`, the `MongoClient` (the pool), and the tenant resolver.
 *
 * Every organization resolves to the **same** in-memory store, which is the
 * honest mock of db-per-organization: there is one fake, so isolation is not
 * what this profile tests. That is deliberate — a `mock` run proves routing,
 * guards and query translation; only a live run against real Mongo can prove
 * that two organizations' collections actually live apart, and that is what the
 * `mongosh` check in the tenancy verification does.
 */
export const fakeMongoLayer = (
  seed: Record<string, ReadonlyArray<BackendRow>> = {},
): FakeInfrastructure<
  FakeMongoDb,
  MongoClientTag | MongoDatabaseTag | TenantDatabaseResolverTag
> => {
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
    layer: Layer.mergeAll(
      Layer.succeed(MongoDatabaseTag, db.db as never),
      // `client.db(name)` ignores the name for the same reason.
      Layer.succeed(MongoClientTag, { db: () => db.db } as never),
      Layer.succeed(TenantDatabaseResolverTag, {
        forOrganization: () => Effect.succeed(db.db),
      }),
    ),
  };
};

export const fakeRedisLayer = (): FakeInfrastructure<FakeRedis, RedisTag> => {
  const redis = makeFakeRedis();
  return {
    driver: redis,
    layer: Layer.succeed(RedisTag, redis.redis as never),
  };
};

/**
 * The tag carries an `AmqpConnector`, not a channel — a held channel does not
 * survive the broker restarting, so the real adapter asks for one per call. The
 * fixture therefore has to supply that indirection rather than handing the fake
 * channel over directly: a layer that provided the channel would satisfy the
 * type through a cast and then fail at the first `withChannel` call.
 */
export const fakeAmqpLayer = (): FakeInfrastructure<
  FakeAmqpChannel,
  AmqpChannelTag
> => {
  const channel = makeFakeAmqpChannel();
  const connector: AmqpConnector = {
    withChannel: use => use(channel.channel as never),
    addConsumer: setup => setup(channel.channel as never),
  };
  return {
    driver: channel,
    layer: Layer.succeed(AmqpChannelTag, connector),
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
    new ConfigurationClientInMemory(plain),
  );
