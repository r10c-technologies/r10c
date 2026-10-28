import { SessionStoreTag, TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import {
  RedisHealthProbeLayer,
  RedisLayer,
  RedisOneTimeTokenStoreLayer,
  RedisSessionStoreLayer,
} from '@entifix/redis';
import { logMechanismOutcome } from '@entifix/service-shell';
import {
  ZitadelActionsLayer,
  ZitadelHealthProbeLayer,
  ZitadelManagementLayer,
  ZitadelOidcLayer,
} from '@entifix/zitadel';
import {
  AccountRepositoryTag,
  IdentityProviderTag,
  makeSessionIdentityProvider,
  NotificationPortTag,
  SessionScopeResolverTag,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import {
  makeDevNotificationPort,
  makeMongoAccountRepository,
  makeMongoSessionScopeResolver,
  makeMongoUserDeviceRepository,
} from '@r10c/implementation-auth-mongo';
import {
  IdTokenStoreLayer,
  LifecycleCursorLayer,
  ProviderSessionIndexLayer,
} from '@r10c/implementation-session-redis';
import {
  fleetBusLayer,
  type FleetConfiguration,
  fleetOutboxLayer,
  fleetPolicyLayer,
  fleetSingleMongoLayer,
  logSliceOutcome,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  LifecycleSweepIntervalMs,
  startLifecycleReconciler,
} from './lifecycle-reconciler.js';
import { startOrganizationRebuild } from './organization-rebuild.js';
import { JWT_AUDIENCE, JWT_ISSUER } from './session-policy.js';
import { AuthnHostLayer } from './zitadel-ports.js';

const SERVICE_NAME = 'auth-service';
/**
 * The **slice**, not the deployment — stamped onto every event this process
 * announces (ADR 0029).
 */
export const AUTH_SLICE = 'auth';

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
export const IdentityProviderLayer = Layer.effect(
  IdentityProviderTag,
  Effect.gen(function* () {
    const sessionStore = yield* SessionStoreTag;
    const accounts = yield* AccountRepositoryTag;
    return makeSessionIdentityProvider(sessionStore, accounts);
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
/**
 * What the service brings to its slice's composition: the lab's accounts,
 * tenancy and provider humans are the app's data, so its seed is handed in
 * rather than owned here (ADR 0064). Generic in what the seed needs, so the
 * compiler still checks that the composition provides it.
 */
export interface AuthShellOptions<R> {
  /**
   * Writes the lab's accounts and the named organization's tenancy, and answers
   * what it could not provision. Best-effort by design — a provider that is not
   * up yet must not stop the boot — so a shortfall is reported, not failed, and
   * this shell is what logs it.
   */
  readonly seed: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<SeedShortfall>, unknown, R>;
}

/** One seeded record the seed could not provision, and why. */
export interface SeedShortfall {
  /** What identifies the record in a log line — never a secret. */
  readonly record: Readonly<Record<string, unknown>>;
  readonly failure: unknown;
}

/** Logs each shortfall a seed answered, at the fork site that ran it. */
export const reportSeedShortfalls = (
  shortfalls: ReadonlyArray<SeedShortfall>,
) =>
  Effect.forEach(
    shortfalls,
    ({ record, failure }) =>
      logSliceOutcome(
        'Warn',
        'could not provision a seeded record at the identity provider',
        record,
        failure,
      ),
    { discard: true },
  );

export const authComposition =
  <R>(options: AuthShellOptions<R>) =>
  (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      const redisUri = yield* store.in('redis').getString('uri');
      // The bus an organization's announcement leaves on (ADR 0061). ⚠️
      // `getNumber`, never a cast: `'five'` would cast to `NaN` and nothing would
      // ever be quarantined.
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
      // ⚠️ `getNumber`, never a cast: `'three minutes'` would cast to `NaN` and a
      // daemon scheduled on `NaN` never fires, silently.
      const lifecycleSweepIntervalMs = yield* store
        .in('lifecycle')
        .getNumber('sweepIntervalMs');

      const infra = Layer.mergeAll(
        yield* fleetSingleMongoLayer(configuration, ['auth']),
        RedisLayer({ uri: redisUri }),
        yield* fleetBusLayer(configuration),
        yield* fleetOutboxLayer(configuration, AUTH_SLICE),
        // The grant table, the crossing policy and the configuration; the token
        // service is this service's own below, because it is the one that signs.
        fleetPolicyLayer(configuration),
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
        Layer.succeed(LifecycleSweepIntervalMs, lifecycleSweepIntervalMs),
        // The authorization policy behind `requirePermission`. Static
        // role→permission table today; an attribute-aware engine would replace
        // this one line.
      );

      // Session store + account/device repos build on the connections.
      const stores = Layer.provideMerge(
        Layer.mergeAll(
          RedisSessionStoreLayer(),
          RedisOneTimeTokenStoreLayer(),
          IdTokenStoreLayer,
          ProviderSessionIndexLayer,
          LifecycleCursorLayer,
          AccountRepositoryLayer,
          SessionScopeResolverLayer,
          UserDeviceRepositoryLayer,
          NotificationLayer,
          // The provider ports over Zitadel, the published key set and the
          // development mailbox: what the `authn/http` routes need from here.
          AuthnHostLayer,
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
          // `auth` is the control-plane store holding identity, party and access
          // records; `session` is the Redis one beside it (ADR 0031).
          RedisHealthProbeLayer(['session']),
          // A service that cannot reach its identity provider cannot sign anyone
          // in, so readiness has to say so — this is now as load-bearing as Mongo.
          ZitadelHealthProbeLayer(zitadelIssuer),
        ),
        withIdentity,
      );

      // Seed users, the demo tenant, and the provider-side humans. The last runs
      // after `seedUsers`, because it links against records that must exist.
      //
      // The outbox's unique index comes first, because the organization seed
      // writes into it. The rebuild walk is **chained** after the seed rather
      // than merged beside it, so it re-states what the seed just wrote instead
      // of racing it.
      const seed = Layer.effectDiscard(
        Effect.flatMap(MongoDatabaseTag, ensureOutboxIndexes).pipe(
          Effect.andThen(options.seed(demoOrganizationId)),
          Effect.flatMap(reportSeedShortfalls),
          Effect.andThen(startOrganizationRebuild),
        ),
      );
      // Replaces Effect's default logger with the tooling logger and stands up
      // the OTel tracer + meter, so sign-in, back-channel logout and the provider
      // lifecycle webhook are traceable. Merged rather than provided: it supplies
      // no service anything here requires, it changes how the whole layer logs.
      // The backstop for lifecycle events the webhook could not be handed,
      // started after the seed so its first pass runs against a populated store
      // (#65). Discarded like the seed: it provides nothing, it starts something.
      const reconciler = Layer.effectDiscard(startLifecycleReconciler);
      // The slow half of the outbox: what was written but not yet on the bus is
      // swept every interval, and once more at shutdown.
      const relay = Layer.effectDiscard(
        startOutboxRelay({ onOutcome: logMechanismOutcome }),
      );

      return Layer.provideMerge(
        Layer.mergeAll(seed, reconciler, relay),
        withProbes,
      );
    });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = <R>(options: AuthShellOptions<R>) =>
  makeFleetServiceLayer(SERVICE_NAME, authComposition(options));
