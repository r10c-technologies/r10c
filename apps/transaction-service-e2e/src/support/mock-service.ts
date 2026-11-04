import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
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
} from '@entifix/testing-e2e/fixtures';
import { makeFakeFlowEngine } from '@entifix/testing-unit';
import { FlowEngineTag } from '@entifix/transactions';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  r10cServiceCrossingPolicy,
  ROLE_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { flowCatalog } from '@r10c/shells-effect-flow-catalog';
import {
  endpoints,
  policy,
  SERVICE_NAME,
  VendorFactsTag,
} from '@r10c/transaction-service';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';

import { E2E_CROSSING_TOKEN } from './tokens';

/**
 * The configuration the service would otherwise fetch from config-service:
 * only what the routes' guards read. The engine and its participants are
 * fakes here, so no participant address or engine store is read.
 */
const CONFIGURATION = {
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
};

/** A vendor provisioned for every step a checkout or a cancellation takes. */
export const PROVISIONED_VENDOR = 'demo-organization';

/** The engine every start in this run reached, to read what it was given. */
export const engine = makeFakeFlowEngine(flowCatalog, () =>
  Effect.succeed({ ok: true }),
);

/**
 * The `mock` composition root: the real routes, guards and grant table over
 * the engine's fake and stated vendor facts.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.**
 */
const MockAppLayer = Layer.mergeAll(
  Layer.succeed(FlowEngineTag, engine),
  Layer.succeed(VendorFactsTag, {
    entitlementsOf: vendorIds =>
      Effect.succeed(
        new Map(
          vendorIds.map(id => [
            id,
            id === PROVISIONED_VENDOR
              ? ['stock-management', 'shipping-order-management']
              : [],
          ]),
        ),
      ),
  }),
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
);

/** Boots the service's real endpoints in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['transaction'],
    description: fleetToken,
    endpoints,
    policy,
    appLayer: MockAppLayer,
  });
