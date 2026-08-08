import {
  entityIdentifierSeedData,
  IdTokenStoreTag,
  individualSeedData,
  JWT_AUDIENCE,
  JWT_ISSUER,
  makeDevNotificationPort,
  makeMongoAccountRepository,
  makeMongoSessionScopeResolver,
  makeMongoUserDeviceRepository,
  makeRedisIdentityProvider,
  makeRedisIdTokenStore,
  makeRedisProviderSessionIndex,
  membershipSeedData,
  ProviderSessionIndexTag,
  router,
  seedIdentityProvider,
  SERVICE_NAME,
  SessionScopeResolverTag,
  userIdentitySeedData,
} from '@r10c/auth-service';
import {
  AccountRepositoryTag,
  IdentityProviderTag,
  NotificationPortTag,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  OneTimeTokenStoreTag,
  SessionStoreTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import {
  makeRedisOneTimeTokenStore,
  makeRedisSessionStore,
} from '@r10c/entifix-ts-redis-client';
import {
  E2E_KEY_ID,
  E2E_PRIVATE_KEY_PEM,
  E2E_PUBLIC_KEY_PEM,
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import {
  ZitadelManagementTag,
  ZitadelOidcTag,
} from '@r10c/entifix-ts-zitadel-client';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { makeFakeZitadel, MOCK_ISSUER } from './fake-zitadel';

/** What the service would otherwise fetch from config-service at boot. */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/auth' },
    { key: 'db', value: 'auth' },
  ],
  // The JWKS route reads these from configuration rather than from the token
  // service, so the suite has to supply them for `/.well-known/jwks.json` to
  // answer at all.
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  zitadel: [
    { key: 'issuer', value: MOCK_ISSUER },
    { key: 'clientId', value: 'mock-client' },
    { key: 'redirectUri', value: 'http://localhost:3002/api/auth/callback' },
  ],
};

/**
 * The `mock` composition root: the same wiring as the service's own `AppLayer`
 * (`apps/auth-service/src/mongo.ts`) with the *connections* faked — the Redis
 * session store runs over a fake ioredis, the account repository over a fake
 * Mongo, and Zitadel over an in-memory directory — while the real jose token
 * service stands. The profile stays hermetic: nothing here opens a socket, so
 * the sign-in journeys run on every PR without a Zitadel to talk to.
 *
 * What that buys and what it does not: everything r10c owns after the provider
 * answers — state consumption, provisioning, the projection, sessions, tokens,
 * party role, tenancy — is exercised for real. The OIDC protocol itself is not,
 * and cannot be here; that is what the client's unit tests and the live pass are
 * for.
 */
const fakeRedis = makeFakeRedis();
const fakeZitadel = makeFakeZitadel();

const AccountRepositoryLayer = Layer.effect(
  AccountRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoAccountRepository),
);

const UserDeviceRepositoryLayer = Layer.effect(
  UserDeviceRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoUserDeviceRepository),
);

// The real resolver over the fake Mongo, not a stub returning a constant: a
// sign-in resolves party -> membership -> organization for real, so the
// `activeOrganizationId` these specs see in a token is one the shipped lookup
// produced. The collections below are seeded to match.
const SessionScopeResolverLayer = Layer.effect(
  SessionScopeResolverTag,
  Effect.map(MongoDatabaseTag, makeMongoSessionScopeResolver),
);

// The real development adapter, not a stub: the reset journey reads the outbox
// back through `/api/dev/outbox`, so a fake here would test nothing.
const NotificationLayer = Layer.effect(
  NotificationPortTag,
  Effect.map(MongoDatabaseTag, makeDevNotificationPort),
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
    'user-device': [],
    'notification-outbox': [],
    // Control-plane tenancy, so the organization a session acts for is resolved
    // rather than assumed. Alan holds the membership; Ada deliberately does not,
    // which is what makes her sessions carry no tenant scope.
    individual: individualSeedData,
    membership: membershipSeedData('e2e-organization'),
  }).layer,
  fakeConfigurationLayer(CONFIGURATION),
  Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  Layer.succeed(
    TokenServiceTag,
    // Both halves: auth-service is the service that *mints* tokens, so its
    // suite is the one place that legitimately holds a private key.
    makeJoseTokenService({
      privateKeyPem: E2E_PRIVATE_KEY_PEM,
      publicKeyPem: E2E_PUBLIC_KEY_PEM,
      keyId: E2E_KEY_ID,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }),
  ),
  // One in-memory directory behind both halves; see `makeFakeZitadel`.
  Layer.succeed(ZitadelOidcTag, fakeZitadel.oidc),
  Layer.succeed(ZitadelManagementTag, fakeZitadel.management),
  // The real grant table, not a fake — it is what `requirePermission` consults,
  // so stubbing it would make every authorization assertion here meaningless.
  Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
  // The fake ioredis honours set/get/expire/sadd/smembers/del/getdel — enough
  // for the session store, the pending-authorization tokens, the id-token store
  // and the provider-session index.
  Layer.succeed(
    SessionStoreTag,
    makeRedisSessionStore(fakeRedis.redis as never),
  ),
  Layer.succeed(
    OneTimeTokenStoreTag,
    makeRedisOneTimeTokenStore(fakeRedis.redis as never),
  ),
  Layer.succeed(
    IdTokenStoreTag,
    makeRedisIdTokenStore(fakeRedis.redis as never),
  ),
  Layer.succeed(
    ProviderSessionIndexTag,
    makeRedisProviderSessionIndex(fakeRedis.redis as never),
  ),
);

const withAccounts = Layer.provideMerge(
  Layer.mergeAll(
    AccountRepositoryLayer,
    SessionScopeResolverLayer,
    UserDeviceRepositoryLayer,
    NotificationLayer,
  ),
  base,
);
const withIdentity = Layer.provideMerge(IdentityProviderLayer, withAccounts);

// The seeded users need a provider-side human and an `external-subject`
// identifier or they cannot sign in at all, and the authorization journeys are
// all "sign in as X, then…". Reuses the service's own seeding effect rather
// than hand-linking subjects, so the mock cannot drift from what a real boot
// produces.
const MockAppLayer = Layer.provideMerge(
  Layer.effectDiscard(seedIdentityProvider.pipe(Effect.orDie)),
  withIdentity,
);

/**
 * Mark an address as unverified at the provider, so a spec can drive the
 * account-linking vector. Exposed here because the fake is module-scoped.
 */
export const markEmailUnverified = (email: string): void => {
  fakeZitadel.unverified.add(email.toLowerCase());
};

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    router,
    appLayer: MockAppLayer,
  });
