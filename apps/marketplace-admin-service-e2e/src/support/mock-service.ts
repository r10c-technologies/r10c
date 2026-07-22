import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import { AmqpEventBusLayer } from '@r10c/entifix-ts-amqp-client';
import { TokenServiceTag } from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  RedisLockServiceLayer,
  RedisSequenceServiceLayer,
} from '@r10c/entifix-ts-redis-client';
import {
  fakeAmqpLayer,
  fakeConfigurationLayer,
  fakeMongoLayer,
  fakeRedisLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  router,
  seedCatalog,
  SERVICE_NAME,
} from '@r10c/marketplace-admin-service';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot. The values are never dialled — the connections they describe are fakes
 * — but `GET /api/config` reports them, so they stay realistic.
 */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/marketplace-admin' },
    { key: 'db', value: 'marketplace-admin' },
  ],
  redis: [{ key: 'uri', value: 'redis://mock:6379' }],
  rabbitmq: [{ key: 'uri', value: 'amqp://mock:5672' }],
  jwt: [{ key: 'secret', value: 'mock-secret' }],
};

/** The HS256 secret the mock verifies with; a spec signs test tokens with it. */
export const MOCK_JWT_SECRET = 'mock-secret';

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`
 * (`apps/marketplace-admin-service/src/mongo.ts`), with the three *connections*
 * replaced by driver fakes and the config-service fetch replaced by a literal.
 *
 * Everything above the connections is untouched — the Mongo repository, the
 * Redis lock and sequence services, the AMQP event bus and the catalog seed all
 * run their real code. That is what makes a green `mock` run mean something:
 * the routes, use-cases and query translation under test are the shipped ones.
 */
const MockAppLayer = (() => {
  const connections = Layer.mergeAll(
    fakeMongoLayer().layer,
    fakeRedisLayer().layer,
    fakeAmqpLayer().layer,
    Layer.succeed(
      TokenServiceTag,
      makeJoseTokenService({
        secret: MOCK_JWT_SECRET,
        issuer: AUTH_TOKEN_ISSUER,
        audience: AUTH_TOKEN_AUDIENCE,
      }),
    ),
    fakeConfigurationLayer(CONFIGURATION),
    Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  );

  const infra = Layer.provideMerge(
    Layer.mergeAll(
      RedisLockServiceLayer,
      RedisSequenceServiceLayer,
      AmqpEventBusLayer,
    ),
    connections,
  );

  // The REAL seed, so both profiles serve the same catalog and the shared
  // journeys can assert the same brand names.
  return Layer.provideMerge(Layer.effectDiscard(seedCatalog), infra);
})();

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    // Overridden by `serveTestService`, which binds an ephemeral port.
    port: 0,
    router,
    appLayer: MockAppLayer,
  });
