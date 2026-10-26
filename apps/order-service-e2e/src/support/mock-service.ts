import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
import { MongoRepositoryFactoryLayer } from '@entifix/mongo';
import {
  MongoUnitOfWorkLayer,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { ServiceCrossingTokenTag } from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import {
  type RunningTestService,
  serveTestService,
} from '@entifix/service-shell/testing';
import {
  E2E_KEY_ID,
  E2E_PUBLIC_KEY_PEM,
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@entifix/testing-e2e/fixtures';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  r10cServiceCrossingPolicy,
  ROLE_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { CancelWindowSeconds } from '@r10c/business-ts-order-management';
import { MongoProductOrderStoreLayer } from '@r10c/implementation-order-mongo';
import { ORDER_SLICE, router, SERVICE_NAME } from '@r10c/order-service';
import { httpSagaStarterLayer } from '@r10c/shells-effect-service';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Layer } from 'effect';

import { E2E_CROSSING_TOKEN } from './tokens';

/**
 * Where this profile's cancellation entry routes would dispatch.
 *
 * ⚠️ **Unreachable on purpose.** No mock spec runs a flow — that needs live
 * participants — so what these routes are asserted on is everything *before* the
 * dispatch: the credential each accepts, the scope check, and the refusals. An
 * address that resolved would make a green run depend on what answered it.
 */
const COORDINATOR_URL = 'http://coordinator.invalid/api';

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot.
 *
 * ⚠️ **`mongo.db` is present and there is no `tenant` group at all** — the
 * inverse of stock-service's fixture next door. The `order` store is platform
 * plane and single, so it names one database at boot; a `dbPrefix` here would
 * model a tenancy the store does not have.
 */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/order' },
    { key: 'db', value: 'order' },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
  // The buyer's cancel window. A literal here for the same reason every other
  // row is: the fixture is the config-service fetch, not a stub of the dial.
  order: [{ key: 'cancelWindowSeconds', value: '1800' }],
  // Where this service starts a cancellation. The real composition root reads
  // both rows; this profile builds the two tags directly below, and the rows are
  // here so the fixture keeps describing the same config-service document.
  transaction: [
    { key: 'url', value: COORDINATOR_URL },
    { key: 'crossingToken', value: E2E_CROSSING_TOKEN },
  ],
};

/** Matches the seeded row, and the storefront's `RECEIPT_TTL_SECONDS`. */
const E2E_CANCEL_WINDOW_SECONDS = 1800;

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`,
 * with the Mongo connection replaced by a driver fake and the config-service
 * fetch by a literal.
 *
 * Everything above the connection runs its real code — the routes, the guards,
 * the order write and its outbox entry in one transaction, and the command
 * claim inside it. That is what makes a green `mock` run mean something.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.** It is
 * what `requirePermission` consults, so replacing it would make every
 * authorization assertion here vacuous — including the one that matters most,
 * that **no role** holds `order-management:product-order:write`.
 */
const connections = Layer.mergeAll(
  fakeMongoLayer().layer,
  Layer.succeed(
    TokenServiceTag,
    makeJoseTokenService({
      publicKeyPem: E2E_PUBLIC_KEY_PEM,
      keyId: E2E_KEY_ID,
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    }),
  ),
  Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision(ROLE_PERMISSIONS)),
  Layer.succeed(ServiceCrossingPolicyTag, r10cServiceCrossingPolicy),
  fakeConfigurationLayer(CONFIGURATION),
  Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  Layer.succeed(ServiceCrossingTokenTag, E2E_CROSSING_TOKEN),
  Layer.succeed(CancelWindowSeconds, E2E_CANCEL_WINDOW_SECONDS),
  httpSagaStarterLayer({
    url: COORDINATOR_URL,
    crossingToken: E2E_CROSSING_TOKEN,
  }),
  // Records what the store announces; under `mock` nothing consumes it.
  Layer.succeed(EventBusTag, makeRecordingEventBus()),
  Layer.succeed(OutboxMaxAttempts, 5),
  Layer.succeed(EventSourceTag, ORDER_SLICE),
);

/** The store's own layers over the fake driver, as the shell composes them. */
const MockAppLayer = Layer.provideMerge(
  Layer.mergeAll(MongoProductOrderStoreLayer, MongoRepositoryFactoryLayer),
  Layer.provideMerge(MongoUnitOfWorkLayer, connections),
).pipe(Layer.orDie);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['order'],
    description: fleetToken,
    router,
    appLayer: MockAppLayer,
  });
