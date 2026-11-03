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
import {
  endpoints,
  policy,
  SERVICE_NAME,
  streamRoutes,
} from '@r10c/realtime-service';
import {
  RealtimePushLayer,
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
 * The `mock` composition root: the service's real stream route, push hub,
 * projections and broadcast subscriptions, with the token verified by the real
 * jose adapter and grants from the real `ROLE_PERMISSIONS`. Only the broker and
 * the config-service fetch are replaced.
 */
const MockAppLayer = Layer.provideMerge(
  Layer.effectDiscard(startPushSubscriptions),
  Layer.mergeAll(
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
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision(ROLE_PERMISSIONS)),
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
    router: streamRoutes,
    appLayer: MockAppLayer,
  });
