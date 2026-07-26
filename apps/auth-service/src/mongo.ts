import {
  AccountRepositoryTag,
  AttemptLimiterTag,
  IdentityProviderTag,
  NotificationPortTag,
  PasswordHasherTag,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
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
  RedisOneTimeTokenStoreLayer,
  RedisSessionStoreLayer,
  RedisTag,
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
import { makeRedisAttemptLimiter } from './identity/attempt-limiter';
import { makeDevNotificationPort } from './identity/notifications';
import { makeBcryptPasswordHasher } from './identity/password';
import { makeRedisIdentityProvider } from './identity/redis-identity-provider';
import {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './identity/session-policy';
import { makeMongoUserDeviceRepository } from './identity/user-device-repository';
import {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';

const SERVICE_NAME = 'auth-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * Reconciles seed docs one at a time: insert what is missing, and bring what is
 * already there back in line with the seed.
 *
 * Per-document rather than "insert only when the collection is empty", because
 * an empty-collection guard silently skips a store seeded by an earlier version
 * of the seed — which is exactly how a long-lived dev database ended up with
 * users that predate the `role` aspect and so logged in as `user` regardless of
 * the tier they were supposed to have.
 */
function seedCollection(
  collectionName: string,
  data: ReadonlyArray<Record<string, unknown>>,
) {
  return Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const collection = db.collection(collectionName);
    for (const item of data) {
      const existing = yield* Effect.promise(() =>
        collection.findOne({ id: item['id'] }),
      );
      if (existing === null) {
        yield* Effect.promise(() => collection.insertMany([{ ...item }]));
      } else {
        yield* Effect.promise(() =>
          collection.updateOne({ id: item['id'] }, { $set: { ...item } }),
        );
      }
    }
  });
}

const seedUsers = Effect.all(
  [
    seedCollection('user-identity', userIdentitySeedData),
    seedCollection('entity-identifier', entityIdentifierSeedData),
  ],
  { discard: true },
);

/**
 * Give each seeded user a password so local login works out of the box.
 *
 * Per user, for the same reason {@link seedCollection} is: a seed user added
 * after the store was first populated would otherwise never get a credential
 * and could never sign in. Existing credentials are left alone — rehashing them
 * on every boot would be pointless work, and would stomp a password a developer
 * changed on purpose.
 */
export const seedCredentials = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const hasher = yield* PasswordHasherTag;
  const collection = db.collection(CREDENTIAL_COLLECTION);

  const missing: unknown[] = [];
  for (const user of userIdentitySeedData) {
    const userId = user['id'];
    const existing = yield* Effect.promise(() =>
      collection.findOne({ userId }),
    );
    if (existing === null) {
      missing.push(userId);
    }
  }
  if (missing.length === 0) {
    return;
  }

  // One hash for all of them: bcrypt is intentionally slow, and the hasher is
  // pure JS here, so hashing per user pushed service boot past the e2e hook
  // timeout. They all share the same dev password anyway.
  const passwordHash = yield* hasher.hash(DEV_SEED_PASSWORD);
  yield* Effect.promise(() =>
    collection.insertMany(missing.map(userId => ({ userId, passwordHash }))),
  );
});

/** Account repository over the live Mongo connection. */
const AccountRepositoryLayer = Layer.effect(
  AccountRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoAccountRepository),
);

/** Durable device history, over the same Mongo connection. */
const UserDeviceRepositoryLayer = Layer.effect(
  UserDeviceRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoUserDeviceRepository),
);

/**
 * Notifications. The development adapter logs and records; swapping in a real
 * transport is a change to this one line.
 */
const NotificationLayer = Layer.effect(
  NotificationPortTag,
  Effect.map(MongoDatabaseTag, makeDevNotificationPort),
);

/** Failed sign-in accounting, over the same Redis connection as the sessions. */
const AttemptLimiterLayer = Layer.effect(
  AttemptLimiterTag,
  Effect.map(RedisTag, makeRedisAttemptLimiter),
);

/** The real identity provider, built from the session store + account repo. */
const IdentityProviderLayer = Layer.effect(
  IdentityProviderTag,
  Effect.gen(function* () {
    const sessionStore = yield* SessionStoreTag;
    const accounts = yield* AccountRepositoryTag;
    return makeRedisIdentityProvider(sessionStore, accounts);
  }),
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
        }),
      ),
      Layer.succeed(PasswordHasherTag, makeBcryptPasswordHasher()),
      // The authorization policy behind `requirePermission`. Static
      // role→permission table today; an attribute-aware engine would replace
      // this one line.
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    );

    // Session store + account/device repos build on the connections.
    const stores = Layer.provideMerge(
      Layer.mergeAll(
        RedisSessionStoreLayer(),
        RedisOneTimeTokenStoreLayer(),
        AttemptLimiterLayer,
        AccountRepositoryLayer,
        UserDeviceRepositoryLayer,
        NotificationLayer,
      ),
      infra,
    );

    // The identity provider consumes the session store + account repo.
    const withIdentity = Layer.provideMerge(IdentityProviderLayer, stores);

    // Seed users + their credentials once everything is wired.
    const seed = Layer.effectDiscard(
      Effect.all([seedUsers, seedCredentials], { discard: true }),
    );
    return Layer.provideMerge(seed, withIdentity);
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
