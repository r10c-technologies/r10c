import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import { TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
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
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { EventBusTag } from '@entifix/transactions';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import { ROLE_PERMISSIONS } from '@r10c/business-ts-authz-grants';
import { FlowStatusStoreTag } from '@r10c/business-ts-flow-contracts';
import { makeInMemoryFlowStatusStore } from '@r10c/business-ts-flow-contracts/testing';
import {
  endpoints,
  policy,
  realtimeRoutes,
  SERVICE_NAME,
} from '@r10c/realtime-service';
import {
  RealtimePushLayer,
  startFlowStatusProjection,
  startPushSubscriptions,
} from '@r10c/shells-effect-realtime';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Layer } from 'effect';

/**
 * The configuration the service would otherwise fetch from config-service.
 * The SSE dials are short so a reauth is observable inside one spec.
 */
const CONFIGURATION = {
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  realtime: [
    { key: 'retryMinMs', value: '10' },
    { key: 'retryMaxMs', value: '20' },
    { key: 'reauthMarginMs', value: '0' },
    { key: 'drainWindowMs', value: '100' },
  ],
};

/**
 * The broker, replaced by a recording bus a spec delivers into. Every replica
 * binds its own broadcast queue in production; delivering here is what a
 * message reaching that queue looks like to the subscription.
 */
export const MOCK_BUS = makeRecordingEventBus();

/**
 * The `flow-status` store, as the contract-tested double. The Mongo cell
 * answers the same suite one level below, against a driver fake.
 */
export const MOCK_FLOW_STATUS = makeInMemoryFlowStatusStore();

/**
 * The `mock` composition root: the service's real routes, push hub,
 * projections, broadcast subscriptions and flow-status projection, with the
 * token verified by the real jose adapter and grants from the real
 * `ROLE_PERMISSIONS`. Only the broker, the store's driver and the
 * config-service fetch are replaced.
 */
const MockAppLayer = Layer.provideMerge(
  Layer.mergeAll(
    Layer.effectDiscard(startPushSubscriptions),
    Layer.effectDiscard(startFlowStatusProjection),
  ),
  Layer.mergeAll(
    Layer.succeed(FlowStatusStoreTag, MOCK_FLOW_STATUS),
    RealtimePushLayer({
      dials: {
        retryMs: { min: 10, max: 20 },
        reauthMarginMs: 0,
        drainWindowMs: 100,
      },
    }),
    Layer.succeed(EventBusTag, MOCK_BUS),
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
    fakeConfigurationLayer(CONFIGURATION),
    Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
  ),
).pipe(Layer.orDie);

/** Boots the service's real routes in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['realtime'],
    description: fleetToken,
    endpoints,
    policy,
    router: realtimeRoutes,
    appLayer: MockAppLayer,
  });
