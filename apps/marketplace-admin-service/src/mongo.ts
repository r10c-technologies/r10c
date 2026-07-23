import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import { AmqpEventBusLayer, AmqpLayer } from '@r10c/entifix-ts-amqp-client';
import {
  ConfigurationRepositoryTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import { MongoDatabaseLayer } from '@r10c/entifix-ts-mongo-client';
import {
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
    const redisUri = yield* store.in('redis').getString('uri');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');
    const jwtSecret = yield* store.in('jwt').getString('secret');

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
    // verifies access tokens minted by auth-service (shared HS256 secret).
    const connections = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      RedisLayer({ uri: redisUri }),
      AmqpLayer({ uri: amqpUri }),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          secret: jwtSecret,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        })
      ),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain)
    );

    // Transaction ports built from those connections (lock/sequence over Redis,
    // event bus over AMQP), merged back so the routes can use every service.
    const infra = Layer.provideMerge(
      Layer.mergeAll(
        RedisLockServiceLayer,
        RedisSequenceServiceLayer,
        AmqpEventBusLayer
      ),
      connections
    );

    // Seed depends on MongoDatabaseTag from `infra`; provideMerge keeps the
    // infra services in the output so the routes can use them. Observability
    // (logger replacement + tracer) is merged so it is active for the server.
    return Layer.merge(
      observability,
      Layer.provideMerge(Layer.effectDiscard(seedCatalog), infra)
    );
  }).pipe(Effect.orDie)
).pipe(Layer.orDie);
