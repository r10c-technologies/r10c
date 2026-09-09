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
import {
  router,
  SERVICE_NAME,
  SimulatedPaymentProviderLayer,
} from '@r10c/payment-service';
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
 * inverse of stock-service's fixture next door. The `payment` store is platform
 * plane and single, so it names one database at boot; a `dbPrefix` here would
 * model a tenancy the store does not have.
 *
 * There is no `rabbitmq` or `outbox` group either, and no bus in the layer
 * below: the mock profile asserts the route surface and its guards, and a broker
 * would be a second process for a `mock` run to depend on. What the outbox does
 * is covered where it is testable without one — the shared relay's own specs.
 */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/payment' },
    { key: 'db', value: 'payment' },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
};

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`,
 * with the Mongo connection replaced by a driver fake and the config-service
 * fetch by a literal.
 *
 * Everything above the connection runs its real code — the routes, the guards,
 * the provider port, and the payment write with its outbox entry and command
 * claim in one transaction. That is what makes a green `mock` run mean
 * something.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.** It is
 * what `requirePermission` consults, so replacing it would make every
 * authorization assertion here vacuous — including the one that matters most,
 * that **no role** holds `payment-management:payment:write`.
 *
 * ⚠️ **The provider is the real simulated adapter**, not a mock of it. It is the
 * thing under test as much as the route is: the decline path decides whether the
 * saga's pivot commits, and asserting it against a stub would assert the stub.
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
  SimulatedPaymentProviderLayer({
    outcome: 'capture',
    declineReason: 'simulated decline',
  }),
).pipe(Layer.orDie);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['payment'],
    router,
    appLayer: MockAppLayer,
  });
