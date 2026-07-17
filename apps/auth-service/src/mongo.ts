import { IdentityProviderTag } from '@r10c/business-ts-authn';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import {
  MongoDatabaseLayer,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { makeStubIdentityProvider } from './identity/stub-identity-provider';
import {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';

const SERVICE_NAME = 'auth-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/** Inserts seed docs into a collection when it is empty. */
function seedCollection(
  collectionName: string,
  data: ReadonlyArray<Record<string, unknown>>
) {
  return Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const collection = db.collection(collectionName);
    const count = yield* Effect.promise(() => collection.countDocuments());
    if (count === 0 && data.length > 0) {
      yield* Effect.promise(() =>
        collection.insertMany(data.map((item) => ({ ...item })))
      );
    }
  });
}

const seedUsers = Effect.all(
  [
    seedCollection('user-identity', userIdentitySeedData),
    seedCollection('entity-identifier', entityIdentifierSeedData),
  ],
  { discard: true }
);

/**
 * auth-service composition root. Resolves Mongo settings from config-service at
 * boot, opens the connection, provides the configuration store + loaded config,
 * seeds the user collections, and keeps the (stub) identity provider. The real
 * Zitadel/Redis adapter would replace the stub here without touching routes.
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
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(IdentityProviderTag, makeStubIdentityProvider())
    );

    return Layer.provideMerge(Layer.effectDiscard(seedUsers), infra);
  }).pipe(Effect.orDie)
).pipe(Layer.orDie);
