import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { IdempotencyStoreTag, TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
import { MongoTenantRepositoryFactoryLayer } from '@entifix/mongo';
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
import {
  makeInMemoryIdempotencyStore,
  makeRecordingEventBus,
} from '@entifix/testing-unit';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  r10cServiceCrossingPolicy,
  ROLE_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import {
  endpoints,
  FULFILMENT_SLICE,
  policy,
  SERVICE_NAME,
} from '@r10c/fulfilment-service';
import { MongoShippingOrderStoreLayer } from '@r10c/implementation-fulfilment-mongo';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Layer } from 'effect';

import { E2E_CROSSING_TOKEN } from './tokens';

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot, as literals — what `GET /api/config` reports under `mock`.
 */
const CONFIGURATION = {
  mongo: [{ key: 'uri', value: 'mongodb://mock/fulfilment' }],
  tenant: [{ key: 'dbPrefix', value: 'fulfilment_' }],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
};

/** What the store announced, for a spec to assert the outbox drained. */
export const bus = makeRecordingEventBus();

/**
 * The `mock` composition root: the service's own shape with the Mongo
 * connection replaced by a driver fake and the config-service fetch by a
 * literal. The routes, the tenant resolver, the conditional moves and the
 * outbox all run their real code.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub**, so
 * the vendor verbs are refused to a role without them for the real reason.
 */
const MockAppLayer = (() => {
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
    Layer.succeed(
      PolicyDecisionTag,
      makeStaticPolicyDecision(ROLE_PERMISSIONS),
    ),
    Layer.succeed(ServiceCrossingPolicyTag, r10cServiceCrossingPolicy),
    fakeConfigurationLayer(CONFIGURATION),
    Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
    Layer.succeed(ServiceCrossingTokenTag, E2E_CROSSING_TOKEN),
    Layer.succeed(
      IdempotencyStoreTag,
      makeInMemoryIdempotencyStore({ retentionMs: 60_000 }),
    ),
    Layer.succeed(EventBusTag, bus),
    Layer.succeed(OutboxMaxAttempts, 5),
    Layer.succeed(EventSourceTag, FULFILMENT_SLICE),
    Layer.succeed(
      FlowStarterTag,
      makeScriptedFlowStarter((recipe, input, key) => {
        flowStarts.push({ recipe, input, key });
        return acceptedAnswer(`delivery-${String(flowStarts.length)}`);
      }),
    ),
  );

  return Layer.provideMerge(
    Layer.mergeAll(
      MongoShippingOrderStoreLayer,
      MongoTenantRepositoryFactoryLayer,
    ),
    connections,
  ).pipe(Layer.orDie);
})();

/**
 * Every delivery a dispatch asked the coordinator to start, in order. The
 * coordinator is scripted: what a start then does is transaction-service's
 * suite's, and the live pass's.
 */
export const flowStarts: Array<{
  readonly recipe: string;
  readonly input: unknown;
  readonly key: string;
}> = [];

/** Boots the service's real endpoints in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['fulfilment'],
    description: fleetToken,
    endpoints,
    policy,
    appLayer: MockAppLayer,
  });
