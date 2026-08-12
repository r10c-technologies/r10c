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
  ConfigurationRepositoryTag,
  SessionStoreTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  MongoDatabaseLayer,
  MongoDatabaseTag,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  RedisHealthProbeLayer,
  RedisLayer,
  RedisOneTimeTokenStoreLayer,
  RedisSessionStoreLayer,
} from '@r10c/entifix-ts-redis-client';
import {
  ZitadelActionsLayer,
  ZitadelHealthProbeLayer,
  ZitadelManagementLayer,
  ZitadelManagementTag,
  ZitadelOidcLayer,
} from '@r10c/entifix-ts-zitadel-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { makeMongoAccountRepository } from './identity/account-repository';
import { IdTokenStoreLayer } from './identity/id-token-store';
import { makeDevNotificationPort } from './identity/notifications';
import { ProviderSessionIndexLayer } from './identity/provider-session-index';
import { provisionZitadelHuman } from './identity/provisioning';
import { makeRedisIdentityProvider } from './identity/redis-identity-provider';
import {
  DEV_SEED_PASSWORD,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from './identity/session-policy';
import {
  makeMongoSessionScopeResolver,
  SessionScopeResolverTag,
} from './identity/session-scope';
import {
  entitlementSeedData,
  individualSeedData,
  membershipSeedData,
  organizationSeedData,
  roleSeedData,
} from './identity/tenancy-seed-data';
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
 * Control-plane tenancy seed: the demo organization, the parties behind the
 * seeded accounts, one tenant role, the membership that makes a sign-in resolve
 * to an organization, and what that organization is provisioned for.
 *
 * These are control-plane records — they live in the shared database, not in a
 * tenant one. The organization record is precisely what makes a tenant handle
 * derivable, so it cannot itself live behind one.
 */
const seedTenancy = (organizationId: string) =>
  Effect.all(
    [
      seedCollection('organization', organizationSeedData(organizationId)),
      seedCollection('individual', individualSeedData),
      seedCollection('role', roleSeedData(organizationId)),
      seedCollection('membership', membershipSeedData(organizationId)),
      seedCollection('entitlement', entitlementSeedData(organizationId)),
    ],
    { discard: true },
  );

/**
 * Give each seeded user a Zitadel human to sign in as, and link the two.
 *
 * This is the same `provisionZitadelHuman` the administrative create route
 * runs — deliberately, because a seeding path that wrote its own accounts is
 * a second provisioning implementation to keep correct, and it is exactly the
 * kind that drifts unnoticed. Idempotent by lookup, so a boot against an
 * already-seeded instance adopts what is there and only repairs a missing link.
 *
 * Best-effort as a whole: a Zitadel that is not up yet must not stop the
 * service from booting. The seeded accounts simply cannot sign in until the
 * next boot repairs them, which is visible rather than silent.
 */
export const seedIdentityProvider = Effect.gen(function* () {
  const zitadel = yield* ZitadelManagementTag;
  const accounts = yield* AccountRepositoryTag;

  for (const user of userIdentitySeedData) {
    const userId = String(user['id']);
    const email = entityIdentifierSeedData.find(
      identifier =>
        identifier['userId'] === userId && identifier['type'] === 'email',
    )?.['value'];
    if (typeof email !== 'string') continue;

    yield* provisionZitadelHuman(accounts, zitadel, {
      userId,
      email,
      displayName: user['displayName'] as string | undefined,
      password: DEV_SEED_PASSWORD,
    }).pipe(
      Effect.tapError(error =>
        Effect.logWarning(
          `could not provision ${email} in Zitadel: ${String(error)}`,
        ),
      ),
      Effect.catchAll(() => Effect.void),
    );
  }
});

/** Account repository over the live Mongo connection. */
const AccountRepositoryLayer = Layer.effect(
  AccountRepositoryTag,
  Effect.map(MongoDatabaseTag, makeMongoAccountRepository),
);

/** Which organization a sign-in acts for — a control-plane lookup. */
const SessionScopeResolverLayer = Layer.effect(
  SessionScopeResolverTag,
  Effect.map(MongoDatabaseTag, makeMongoSessionScopeResolver),
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
 * auth-service composition root. Resolves Mongo + Redis + JWT + Zitadel
 * settings from config-service at boot, then layers: connections (Mongo, Redis)
 * + stateless services (jose token service, the OIDC and management clients) →
 * session store + account repo → the real identity provider → seed.
 *
 * Nothing here hashes or compares a password, and there is no layer that could:
 * the credential half of authentication left this service entirely.
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationStoreInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');
    const redisUri = yield* store.in('redis').getString('uri');
    // auth-service is the fleet's only holder of the private key: it is the one
    // service that mints tokens. Everyone else gets `publicKey` alone.
    const jwtPrivateKey = yield* store.in('jwt').getString('privateKey');
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');
    // Shared with marketplace-admin-service, which seeds this organization's
    // catalog into its own database — so the id is configuration rather than a
    // constant duplicated in two codebases.
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');

    // Where identity actually lives. The PAT is per-instance and disposable —
    // the local ladder extracts it after Zitadel's first init and seeds it here,
    // so it is configuration rather than a checked-in secret.
    const zitadelIssuer = yield* store.in('zitadel').getString('issuer');
    const zitadelClientId = yield* store.in('zitadel').getString('clientId');
    const zitadelPat = yield* store.in('zitadel').getString('pat');
    const zitadelRedirectUri = yield* store
      .in('zitadel')
      .getString('redirectUri');
    const zitadelPostLogoutUri = yield* store
      .in('zitadel')
      .getString('postLogoutRedirectUri');
    // Minted by Zitadel when `tools/zitadel-seed.mjs` creates the Actions v2
    // target and never readable again, which is why the seed carries it forward
    // across re-seeds. Blank fails the webhook closed rather than opening it.
    const zitadelActionSigningKey = yield* store
      .in('zitadel')
      .getString('actionSigningKey');

    const infra = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      RedisLayer({ uri: redisUri }),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          privateKeyPem: jwtPrivateKey,
          publicKeyPem: jwtPublicKey,
          keyId: jwtKeyId,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }),
      ),
      ZitadelOidcLayer({
        issuer: zitadelIssuer,
        clientId: zitadelClientId,
        redirectUri: zitadelRedirectUri,
        postLogoutRedirectUri: zitadelPostLogoutUri,
      }),
      ZitadelManagementLayer({
        issuer: zitadelIssuer,
        personalAccessToken: zitadelPat,
      }),
      ZitadelActionsLayer({ signingKey: zitadelActionSigningKey }),
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
        IdTokenStoreLayer,
        ProviderSessionIndexLayer,
        AccountRepositoryLayer,
        SessionScopeResolverLayer,
        UserDeviceRepositoryLayer,
        NotificationLayer,
      ),
      infra,
    );

    // The identity provider consumes the session store + account repo.
    const withIdentity = Layer.provideMerge(IdentityProviderLayer, stores);

    // Readiness probes ship with the clients they describe, so this service
    // never hand-maintains a list of what "ready" means. `HealthRegistryTag` is
    // provided by `makeServerLayer`, which is also what reads the probes back.
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(
        MongoHealthProbeLayer,
        RedisHealthProbeLayer,
        // A service that cannot reach its identity provider cannot sign anyone
        // in, so readiness has to say so — this is now as load-bearing as Mongo.
        ZitadelHealthProbeLayer(zitadelIssuer),
      ),
      withIdentity,
    );

    // Seed users, the demo tenant, and the provider-side humans. The last runs
    // after `seedUsers`, because it links against records that must exist.
    const seed = Layer.effectDiscard(
      Effect.all([seedUsers, seedTenancy(demoOrganizationId)], {
        discard: true,
      }).pipe(Effect.andThen(seedIdentityProvider)),
    );
    return Layer.provideMerge(seed, withProbes);
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
