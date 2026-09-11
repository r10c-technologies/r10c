import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { TokenServiceTag } from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  E2E_KEY_ID,
  E2E_PUBLIC_KEY_PEM,
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import { CancelWindowSeconds, router, SERVICE_NAME } from '@r10c/order-service';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { E2E_CROSSING_TOKEN } from './tokens';

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
const MockAppLayer = Layer.mergeAll(
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
  Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
  fakeConfigurationLayer(CONFIGURATION),
  Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  Layer.succeed(ServiceCrossingTokenTag, E2E_CROSSING_TOKEN),
  Layer.succeed(CancelWindowSeconds, E2E_CANCEL_WINDOW_SECONDS),
).pipe(Layer.orDie);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['order'],
    router,
    appLayer: MockAppLayer,
  });
