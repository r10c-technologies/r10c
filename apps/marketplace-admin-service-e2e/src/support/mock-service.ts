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
import { AmqpEventBusLayer } from '@r10c/entifix-ts-amqp-client';
import { TokenServiceTag } from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  RedisLockServiceLayer,
  RedisSequenceServiceLayer,
} from '@r10c/entifix-ts-redis-client';
import {
  E2E_KEY_ID,
  E2E_PUBLIC_KEY_PEM,
  fakeAmqpLayer,
  fakeConfigurationLayer,
  fakeMongoLayer,
  fakeRedisLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  MongoTransactionStoreLayer,
  OutboxMaxAttempts,
  router,
  SagaDatabaseName,
  seedCatalog,
  SERVICE_NAME,
} from '@r10c/marketplace-admin-service';
import {
  type InMemoryObservability,
  LoadedConfigurationTag,
  makeInMemoryObservabilityLayer,
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
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  tenant: [
    { key: 'dbPrefix', value: 'tenant_' },
    { key: 'demoOrganizationId', value: 'e2e-organization' },
  ],
  outbox: [{ key: 'maxAttempts', value: '5' }],
};

// The key pair itself lives in `@r10c/entifix-ts-testing-e2e` so this layer and
// the spec helper that signs tokens cannot drift onto different keys.

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
        publicKeyPem: E2E_PUBLIC_KEY_PEM,
        keyId: E2E_KEY_ID,
        issuer: AUTH_TOKEN_ISSUER,
        audience: AUTH_TOKEN_AUDIENCE,
      }),
    ),
    // The real policy, not a fake: the grant table is what `requirePermission`
    // consults, so stubbing it here would make every authorization assertion
    // in this suite meaningless.
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    fakeConfigurationLayer(CONFIGURATION),
    Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
    Layer.succeed(SagaDatabaseName, 'transaction_manager'),
    // The shipped layer reads this from config-service; here it is a literal
    // beside the other resolved values, mirroring `SagaDatabaseName`. The
    // matching entry in `CONFIGURATION` is what `GET /api/config` reports.
    Layer.succeed(OutboxMaxAttempts, 5),
    // The slice every event this process publishes is stamped with, matching
    // the shipped layer. The *publishing* slice, so `marketplace-admin` — the
    // co-deployed `transaction` slice consumes, it does not emit.
    Layer.succeed(EventSourceTag, 'marketplace-admin'),
  );

  const infra = Layer.provideMerge(
    Layer.mergeAll(
      RedisLockServiceLayer,
      RedisSequenceServiceLayer,
      AmqpEventBusLayer,
      // The reactive stream's in-process fan-out. Real, not a stub: the SSE
      // route resolves it per connection, so a missing layer would fail the
      // whole router rather than just that route.
      Layer.scoped(TransactionStreamHubTag, makeTransactionStreamHubEffect),
      // The co-deployed `transaction` slice's store, over the same fake pool.
      // It is here rather than stubbed because the router now serves
      // `/api/transaction` — the tracker is passive, so a broken subscription
      // looks exactly like nothing happening, and a fake would hide that.
      MongoTransactionStoreLayer,
    ),
    connections,
  );

  // The REAL seed, so both profiles serve the same catalog and the shared
  // journeys can assert the same brand names. It writes into the tenant
  // database now; the fake resolves every organization to one in-memory store,
  // so the catalog the specs read is the catalog the seed wrote.
  //
  // `orDie` mirrors the shipped `AppLayer`: the saga store's index creation can
  // fail, and a service that cannot open its own store has nothing to serve, so
  // the failure belongs in the defect channel rather than in a caller's types.
  return Layer.provideMerge(
    Layer.effectDiscard(seedCatalog('tenant_e2e-organization')),
    infra,
  ).pipe(Layer.orDie);
})();

/**
 * The real observability wiring with in-memory exporters, merged into the mock
 * app layer. {@link capturedLogRecords} is what the logging spec asserts on: it
 * proves the shipped logger + tracer produce structured, trace-correlated logs.
 */
const observability = makeInMemoryObservabilityLayer(SERVICE_NAME);

/** Log records the service emitted during the in-process mock run. */
export const capturedLogRecords = observability.logRecords;

/**
 * Spans the service exported during the in-process mock run.
 *
 * Annotated rather than inferred: the return type names `ReadableSpan`, which
 * this project does not depend on directly, and an inferred alias for it is not
 * portable across the declaration emit.
 */
export const capturedSpans: InMemoryObservability['getSpans'] =
  observability.getSpans;

const MockAppLayerWithObservability = Layer.merge(
  observability.layer,
  MockAppLayer,
);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    // Overridden by `serveTestService`, which binds an ephemeral port.
    port: 0,
    // The same pair the real process hosts, so `/api/$service` describes the
    // thing under test rather than a reduced version of it.
    slices: ['marketplace-admin', 'transaction'],
    router,
    appLayer: MockAppLayerWithObservability,
  });
