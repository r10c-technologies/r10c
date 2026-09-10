import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  makeTransactionStreamHubEffect,
  TransactionStreamHubTag,
} from '@r10c/entifix-transactions';
import { TokenServiceTag } from '@r10c/entifix-ts-business';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  E2E_KEY_ID,
  E2E_PUBLIC_KEY_PEM,
  fakeConfigurationLayer,
  fakeMongoLayer,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import {
  HttpSagaDispatcherLayer,
  MongoSagaStoreLayer,
  MongoTransactionStoreLayer,
  ParticipantsTag,
  router,
  SagaDatabaseName,
  SERVICE_NAME,
} from '@r10c/transaction-service';
import { Layer } from 'effect';

import { E2E_CROSSING_TOKEN } from './tokens';

/**
 * The configuration the service would otherwise fetch from config-service.
 *
 * The participant addresses are never dialled here — no spec in this suite runs
 * a saga, because doing so needs two live participants — but the composition
 * root reads them, and a tag it cannot build is a layer it cannot build.
 */
const CONFIGURATION = {
  mongo: [{ key: 'uri', value: 'mongodb://mock/saga' }],
  amqp: [{ key: 'uri', value: 'amqp://mock' }],
  saga: [
    { key: 'db', value: 'transaction_manager' },
    { key: 'staleTimeoutMs', value: '60000' },
    { key: 'recoveryIntervalMs', value: '10000' },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
};

/**
 * One settled instance, so the by-id route's **scoping** is provable here and
 * not only against a live fleet.
 *
 * The organization is not a member of the instance — a flow spanning two
 * vendors has two — so it is read off the calls the flow actually made, and
 * seeding one is the only way a mock profile can exercise that.
 */
export const SEEDED_SAGA_ID = 'seeded-saga-1';
export const SEEDED_SAGA_ORGANIZATION = 'demo-organization';

const SEEDED_SAGAS = {
  saga_instances: [
    {
      sagaId: SEEDED_SAGA_ID,
      definition: 'checkout',
      state: 'COMPENSATED',
      stepIndex: 1,
      inputs: {},
      resumeAttempts: 0,
      outcomes: [
        {
          stepId: 'reserve',
          calls: [
            {
              index: 0,
              status: 201,
              body: { data: { id: 'r-0' } },
              organizationId: SEEDED_SAGA_ORGANIZATION,
            },
          ],
          compensated: true,
        },
      ],
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
    },
  ],
};

/**
 * The `mock` composition root.
 *
 * ⚠️ **No AMQP layer and no tracker.** `startTracking` subscribes to the bus and
 * forks a recovery sweep; neither is reachable through the routes this suite
 * exercises, and a fake broker would only assert that the fake works. What runs
 * here is the real router over a fake Mongo — the guards, the organization
 * scoping and the SSE handshake, which is exactly what #194 and ADR 0036 are
 * about.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.**
 */
const MockAppLayer = Layer.provideMerge(
  Layer.mergeAll(
    MongoTransactionStoreLayer,
    MongoSagaStoreLayer,
    Layer.scoped(TransactionStreamHubTag, makeTransactionStreamHubEffect),
    // The dispatcher the run route resolves. Built over an empty participant
    // map: no spec here runs a saga — that needs two live participants — and a
    // definition naming a participant this map lacks fails the *effect* rather
    // than compensating, which is the wiring fault it is.
    HttpSagaDispatcherLayer,
  ),
  Layer.mergeAll(
    fakeMongoLayer(SEEDED_SAGAS).layer,
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
    Layer.succeed(SagaDatabaseName, 'transaction_manager'),
    Layer.succeed(ServiceCrossingTokenTag, E2E_CROSSING_TOKEN),
    Layer.succeed(ParticipantsTag, {}),
  ),
).pipe(Layer.orDie);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['transaction'],
    router,
    appLayer: MockAppLayer,
  });
