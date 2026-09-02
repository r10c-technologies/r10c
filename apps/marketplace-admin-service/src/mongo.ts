import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  EventSourceTag,
  makeTransactionStreamHubEffect,
  TransactionStreamHubTag,
} from '@r10c/entifix-transactions';
import {
  AmqpEventBusLayer,
  AmqpHealthProbeLayer,
  AmqpLayer,
} from '@r10c/entifix-ts-amqp-client';
import {
  ConfigurationRepositoryTag,
  TenantDatabaseResolverTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  makeMongoTenantResolver,
  MongoClientLayer,
  MongoClientTag,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  RedisHealthProbeLayer,
  RedisLayer,
  RedisLockServiceLayer,
  RedisSequenceServiceLayer,
} from '@r10c/entifix-ts-redis-client';
import type { LogLevel } from '@r10c/entifix-ts-tooling/logging';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';
import { Effect } from 'effect';

import { makeObservabilityLayer } from './observability';
import {
  OutboxMaxAttempts,
  startOutboxRelay,
  TenantDatabasePrefix,
} from './outbox/relay';
import { MongoTransactionStoreLayer, SagaDatabaseName } from './saga/store';
import { startTracking } from './saga/tracking';
import { seedCatalog } from './seed';

const SERVICE_NAME = 'marketplace-admin-service';
/** The slice publishing this process's events (ADR 0020, `tools/slices/`). */
const SLICE_NAME = 'marketplace-admin';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The marketplace-admin-service composition root. Resolves its own parameters
 * from config-service at boot (`mongo.uri`), opens the Mongo connection,
 * provides the configuration store + loaded config for introspection, and seeds
 * the catalog collections once.
 *
 * `Layer.unwrapEffect` defers the boot-time config fetch into the layer graph so
 * `makeService`'s `Layer.launch` owns startup and graceful shutdown. Any boot
 * failure (config unreachable, missing keys) crashes the service (`orDie`).
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    // Tenant storage: one Mongo database per organization, named from the
    // organization id. Resolved from config-service like every other
    // cross-service value, so the convention is not duplicated in code.
    const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');
    const redisUri = yield* store.in('redis').getString('uri');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');
    // Publish attempts before the relay quarantines an entry and moves the head
    // of the line. `getNumber` rather than a cast: this is the one config value
    // arithmetic is done on, and `'five'` would otherwise become `NaN` and make
    // every comparison false — quarantining nothing, silently.
    const outboxMaxAttempts = yield* store
      .in('outbox')
      .getNumber('maxAttempts');
    // The `saga` store's database. A *named* handle over the same pool, beside
    // the catalog's per-request tenant handles — see `saga/store.ts` for why it
    // is a name rather than a second `MongoDatabaseLayer`.
    const sagaDbName = yield* store.in('saga').getString('db');
    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    // Observability parameters (log level + sink, OTLP endpoint). The tooling
    // logger replaces Effect's default logger and the OTel tracer exports spans,
    // so every request logs through one trace-correlated pipeline.
    const logLevel = yield* store.in('logging').getString('level');
    const logSink = yield* store.in('logging').getString('sink');
    const otelEndpoint = yield* store.in('otel').getString('endpoint');
    const observability = makeObservabilityLayer({
      serviceName: SERVICE_NAME,
      level: logLevel as LogLevel,
      sink: logSink === 'stdout' ? 'stdout' : 'otlp',
      otelEndpoint,
    });

    // Connections resolved from config-service: Mongo (catalog), Redis (locks +
    // code sequences), RabbitMQ (transaction event bus). The token service
    // verifies RS256 access tokens minted by auth-service.
    const connections = Layer.mergeAll(
      // The pool only. This service owns no single named database: every catalog
      // handle is `tenant_<organizationId>`, resolved per request. Connecting to
      // a named one would put a database in Mongo that nothing ever writes —
      // a phantom store (ADR 0020).
      MongoClientLayer({ uri }),
      RedisLayer({ uri: redisUri }),
      AmqpLayer({ uri: amqpUri }),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem: jwtPublicKey,
          keyId: jwtKeyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(SagaDatabaseName, sagaDbName),
      // Stamped onto every event this process publishes. The **slice**, not the
      // deployment: the `transaction` slice is co-deployed here, and a source
      // that named the process would relabel marketplace-admin's events the day
      // the two split apart again.
      Layer.succeed(EventSourceTag, SLICE_NAME),
      // The outbox relay sweeps every `tenant_<organizationId>` database this
      // slice owns, so it needs the prefix those handles are named with.
      Layer.succeed(TenantDatabasePrefix, tenantPrefix),
      Layer.succeed(OutboxMaxAttempts, outboxMaxAttempts),
      // The authorization policy. Static role→permission table today; swapping
      // in an attribute-aware engine is a change of this line alone.
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    );

    // Transaction ports built from those connections (lock/sequence over Redis,
    // event bus over AMQP), merged back so the routes can use every service.
    // `MongoTransactionStoreLayer` is the co-deployed `transaction` slice's
    // store — the same topic exchange this process publishes to, consumed
    // through the tracker's own exclusive queue bound to `transaction.*`.
    const infra = Layer.provideMerge(
      Layer.mergeAll(
        RedisLockServiceLayer,
        RedisSequenceServiceLayer,
        AmqpEventBusLayer,
        MongoTransactionStoreLayer,
        // The in-process fan-out behind `GET /api/transaction/events`. Scoped,
        // so the connections it holds are released with the server, and shared
        // by the whole process: one bus subscription feeds every browser rather
        // than a broker queue per open tab, which would be a broker resource a
        // client controls.
        Layer.scoped(TransactionStreamHubTag, makeTransactionStreamHubEffect),
      ),
      connections,
    );

    // Every connection contributes its own readiness probe, so
    // `/api/health/ready` describes this service without this file listing what
    // "ready" means. `HealthRegistryTag` comes from `makeServerLayer`.
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(
        MongoHealthProbeLayer,
        RedisHealthProbeLayer,
        AmqpHealthProbeLayer,
      ),
      infra,
    );

    // The tenant resolver: one client, N database handles. It needs the pool
    // (`MongoClientTag`) rather than the shared `Db`, and it is built here — at
    // the composition root — because only this file knows which driver backs
    // the port.
    const tenancy = Layer.provide(
      Layer.effect(
        TenantDatabaseResolverTag,
        Effect.map(MongoClientTag, client =>
          makeMongoTenantResolver(client, tenantPrefix),
        ),
      ),
      withProbes,
    );

    // Seed depends on MongoClientTag from `infra`; provideMerge keeps the
    // infra services in the output so the routes can use them. Observability
    // (logger replacement + tracer) is merged so it is active for the server.
    // `startTracking` is the co-deployed slice's boot step: it subscribes to the
    // bus and forks the recovery sweep. Passive by design — it observes and
    // recovers, and never dispatches work.
    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.mergeAll(
          tenancy,
          Layer.effectDiscard(
            seedCatalog(`${tenantPrefix}${demoOrganizationId}`),
          ),
          Layer.effectDiscard(startTracking),
          // The slow half of the outbox relay. The fast half runs inline in the
          // create route, which already holds the tenant handle; this sweep is
          // what carries an entry the process died before publishing, or one
          // written while the broker was down.
          Layer.effectDiscard(startOutboxRelay),
        ),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
