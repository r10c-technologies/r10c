import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
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
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  makeMongoTenantResolver,
  MongoClientTag,
  MongoDatabaseLayer,
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
    // Tenant storage: one Mongo database per organization, named from the
    // organization id. Resolved from config-service like every other
    // cross-service value, so the convention is not duplicated in code.
    const tenantPrefix = yield* store.in('tenant').getString('dbPrefix');
    const demoOrganizationId = yield* store
      .in('tenant')
      .getString('demoOrganizationId');
    const redisUri = yield* store.in('redis').getString('uri');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');
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
      MongoDatabaseLayer({ uri, dbName }),
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
      // The authorization policy. Static role→permission table today; swapping
      // in an attribute-aware engine is a change of this line alone.
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    );

    // Transaction ports built from those connections (lock/sequence over Redis,
    // event bus over AMQP), merged back so the routes can use every service.
    const infra = Layer.provideMerge(
      Layer.mergeAll(
        RedisLockServiceLayer,
        RedisSequenceServiceLayer,
        AmqpEventBusLayer,
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
    return Layer.merge(
      observability,
      Layer.provideMerge(
        Layer.merge(
          tenancy,
          Layer.effectDiscard(
            seedCatalog(`${tenantPrefix}${demoOrganizationId}`),
          ),
        ),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
