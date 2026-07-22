import {
  AccountRepositoryTag,
  IdentityProviderTag,
  PasswordHasherTag,
} from '@r10c/business-ts-authn';
import {
  ConfigurationRepositoryTag,
  SessionStoreTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  MongoDatabaseLayer,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  RedisLayer,
  RedisSessionStoreLayer,
} from '@r10c/entifix-ts-redis-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  CREDENTIAL_COLLECTION,
  makeMongoAccountRepository,
} from './identity/account-repository';
import { makeBcryptPasswordHasher } from './identity/password';
import { makeRedisIdentityProvider } from './identity/redis-identity-provider';
import {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './identity/session-policy';
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
 * Give each seeded user a password so local login works out of the box. Hashes
 * the shared dev password once and writes one credential per seed user, only
 * when the collection is empty.
 */
const seedCredentials = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const hasher = yield* PasswordHasherTag;
  const collection = db.collection(CREDENTIAL_COLLECTION);
  const count = yield* Effect.promise(() => collection.countDocuments());
  if (count === 0) {
    const passwordHash = yield* hasher.hash(DEV_SEED_PASSWORD);
    yield* Effect.promise(() =>
      collection.insertMany(
        userIdentitySeedData.map((user) => ({
          userId: user['id'],
          passwordHash,
        }))
      )
    );
  }
});

/** Account repository over the live Mongo connection. */
const AccountRepositoryLayer = Layer.effect(
  AccountRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoAccountRepository)
);

/** The real identity provider, built from the session store + account repo. */
const IdentityProviderLayer = Layer.effect(
  IdentityProviderTag,
  Effect.gen(function* () {
    const sessionStore = yield* SessionStoreTag;
    const accounts = yield* AccountRepositoryTag;
    return makeRedisIdentityProvider(sessionStore, accounts);
  })
);

/**
 * auth-service composition root. Resolves Mongo + Redis + JWT settings from
 * config-service at boot, then layers: connections (Mongo, Redis) + stateless
 * services (jose token service, bcrypt hasher) → session store + account repo →
 * the real identity provider → seed. The stub provider is gone; the same routes
 * now run over Redis sessions and Mongo-backed credentials.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationStoreInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');
    const redisUri = yield* store.in('redis').getString('uri');
    const jwtSecret = yield* store.in('jwt').getString('secret');

    const infra = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      RedisLayer({ uri: redisUri }),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          secret: jwtSecret,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        })
      ),
      Layer.succeed(PasswordHasherTag, makeBcryptPasswordHasher())
    );

    // Session store + account repo build on the connections.
    const stores = Layer.provideMerge(
      Layer.mergeAll(RedisSessionStoreLayer(), AccountRepositoryLayer),
      infra
    );

    // The identity provider consumes the session store + account repo.
    const withIdentity = Layer.provideMerge(IdentityProviderLayer, stores);

    // Seed users + their credentials once everything is wired.
    const seed = Layer.effectDiscard(
      Effect.all([seedUsers, seedCredentials], { discard: true })
    );
    return Layer.provideMerge(seed, withIdentity);
  }).pipe(Effect.orDie)
).pipe(Layer.orDie);
