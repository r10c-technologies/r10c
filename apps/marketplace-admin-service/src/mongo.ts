import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { MongoDatabaseLayer } from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';
import { Effect } from 'effect';

import { seedCatalog } from './seed';

const SERVICE_NAME = 'marketplace-admin-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The marketplace-admin-service composition root. Resolves its own parameters
 * from config-service at boot (`mongo.uri` / `mongo.db`), opens the Mongo
 * connection, provides the configuration store + loaded config for
 * introspection, and seeds the catalog collections once.
 *
 * `Layer.unwrapEffect` defers the boot-time config fetch into the layer graph so
 * `makeService`'s `Layer.launch` owns startup and graceful shutdown. Any boot
 * failure (config unreachable, missing keys) crashes the service (`orDie`).
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationStoreInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');

    const infra = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain)
    );

    // Seed depends on MongoDatabaseTag from `infra`; provideMerge keeps the
    // infra services in the output so the routes can use them.
    return Layer.provideMerge(Layer.effectDiscard(seedCatalog), infra);
  }).pipe(Effect.orDie)
).pipe(Layer.orDie);
