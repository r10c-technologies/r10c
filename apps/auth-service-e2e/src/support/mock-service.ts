import {
  entityIdentifierSeedData,
  JWT_AUDIENCE,
  JWT_ISSUER,
  makeBcryptPasswordHasher,
  makeMongoAccountRepository,
  makeRedisIdentityProvider,
  router,
  SERVICE_NAME,
  userIdentitySeedData,
} from '@r10c/auth-service';
import {
  AccountRepositoryTag,
  IdentityProviderTag,
  PasswordHasherTag,
} from '@r10c/business-ts-authn';
import { SessionStoreTag, TokenServiceTag } from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { makeRedisSessionStore } from '@r10c/entifix-ts-redis-client';
import {
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

/** What the service would otherwise fetch from config-service at boot. */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/auth' },
    { key: 'db', value: 'auth' },
  ],
};

/**
 * The `mock` composition root: the same wiring as the service's own `AppLayer`
 * (`apps/auth-service/src/mongo.ts`) with the *connections* faked — the Redis
 * session store runs over a fake ioredis, the account repository over a fake
 * Mongo — while the real jose token service and bcrypt hasher stand. So the
 * credential flow (register → session → token → login) is exercised for real,
 * hermetically, and the same router serves the `live` profile unchanged.
 */
const fakeRedis = makeFakeRedis();

const AccountRepositoryLayer = Layer.effect(
  AccountRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoAccountRepository),
);

const IdentityProviderLayer = Layer.effect(
  IdentityProviderTag,
  Effect.gen(function* () {
    const sessionStore = yield* SessionStoreTag;
    const accounts = yield* AccountRepositoryTag;
    return makeRedisIdentityProvider(sessionStore, accounts);
  }),
);

const base = Layer.mergeAll(
  fakeMongoLayer({
    'user-identity': userIdentitySeedData,
    'entity-identifier': entityIdentifierSeedData,
  }).layer,
  fakeConfigurationLayer(CONFIGURATION),
  Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  Layer.succeed(
    TokenServiceTag,
    makeJoseTokenService({
      secret: 'mock-secret',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }),
  ),
  Layer.succeed(PasswordHasherTag, makeBcryptPasswordHasher()),
  // The fake ioredis honours set/get/expire/sadd — enough for the session store.
  Layer.succeed(SessionStoreTag, makeRedisSessionStore(fakeRedis.redis as never)),
);

const withAccounts = Layer.provideMerge(AccountRepositoryLayer, base);
const MockAppLayer = Layer.provideMerge(IdentityProviderLayer, withAccounts);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    router,
    appLayer: MockAppLayer,
  });
