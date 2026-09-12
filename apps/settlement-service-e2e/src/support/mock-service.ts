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
import { router, SERVICE_NAME } from '@r10c/settlement-service';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { E2E_ORGANIZATION_ID, E2E_OTHER_ORGANIZATION_ID } from './tokens';

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot.
 *
 * ⚠️ **`mongo.db` is present and there is no `tenant.dbPrefix`** — the inverse
 * of stock-service's and sales-service's fixtures. The `settlement` store is
 * control plane and single, so it names one database at boot; a prefix here
 * would model a tenancy the store does not have.
 *
 * ⚠️ **There is no `service` group, and that is the assertion rather than an
 * omission.** Every other service fixture in the fleet carries a crossing token
 * because a saga dispatches into it. Nothing dispatches into this one, and a
 * token here would be a secret the code never reads.
 *
 * There is no `rabbitmq` or `outbox` group either, and no bus in the layer
 * below: the mock profile asserts the route surface and its guards, and a broker
 * would be a second process for a `mock` run to depend on. The fold that reads
 * those queues is covered where it is testable without one — the pure
 * arithmetic's own specs in the service.
 */
const CONFIGURATION = {
  mongo: [
    { key: 'uri', value: 'mongodb://mock/settlement' },
    { key: 'db', value: 'settlement' },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
};

/**
 * Two vendors' worth of records, so a scoped read has something to withhold.
 *
 * ⚠️ **A suite seeded with one vendor cannot tell a correct scope from a missing
 * one.** Every assertion about narrowing would pass against a route that
 * returned everything, which is the failure mode a scope exists to prevent.
 *
 * The agreement carries `counter: 0` for the same reason the service's own seed
 * does: an absent entry and a `0` are different values, and a fixture where
 * every channel charges the same rate cannot tell `commissionFor` from
 * `rates[type] || fallback`.
 */
export const SEEDED_AGREEMENT_ID = `agreement-${E2E_ORGANIZATION_ID}`;
export const SEEDED_OTHER_AGREEMENT_ID = `agreement-${E2E_OTHER_ORGANIZATION_ID}`;
export const SEEDED_ENTRY_ID = 'commission-entry-1';
export const SEEDED_REVERSAL_ID = 'commission-entry-3';
export const SEEDED_PAYOUT_ID = 'vendor-payout-1';
export const SEEDED_RUN_ID = 'settlement-run-1';

const SEED = {
  agreement: [
    {
      id: SEEDED_AGREEMENT_ID,
      vendorId: E2E_ORGANIZATION_ID,
      commissionBasisPoints: 800,
      channelCommissionBasisPoints: { counter: 0 },
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: SEEDED_OTHER_AGREEMENT_ID,
      vendorId: E2E_OTHER_ORGANIZATION_ID,
      commissionBasisPoints: 1200,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  ],
  'commission-entry': [
    {
      id: SEEDED_ENTRY_ID,
      orderId: 'order-1',
      vendorId: E2E_ORGANIZATION_ID,
      saleAmount: 2500,
      commissionAmount: 200,
      currency: 'GTQ',
      occurredAt: new Date('2026-03-04T10:00:00.000Z'),
      kind: 'sale',
    },
    {
      id: 'commission-entry-2',
      orderId: 'order-2',
      vendorId: E2E_OTHER_ORGANIZATION_ID,
      saleAmount: 1000,
      commissionAmount: 120,
      currency: 'GTQ',
      occurredAt: new Date('2026-03-05T10:00:00.000Z'),
      kind: 'sale',
    },
    // The mirror of `commission-entry-1`: same order, same vendor, both signs
    // flipped, filed under when the money went back rather than when it was
    // taken. The fold that writes one of these needs a bus, which the mock
    // profile deliberately has none of — what is exercised here is that a
    // reversal reads back scoped, labelled and separable from a sale.
    {
      id: SEEDED_REVERSAL_ID,
      orderId: 'order-1',
      vendorId: E2E_ORGANIZATION_ID,
      saleAmount: -2500,
      commissionAmount: -200,
      currency: 'GTQ',
      occurredAt: new Date('2026-03-09T08:00:00.000Z'),
      kind: 'reversal',
    },
  ],
  'settlement-run': [
    {
      id: SEEDED_RUN_ID,
      periodStart: new Date('2026-03-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-31T23:59:59.000Z'),
      status: 'calculated',
    },
  ],
  'vendor-payout': [
    {
      id: SEEDED_PAYOUT_ID,
      runId: SEEDED_RUN_ID,
      vendorId: E2E_ORGANIZATION_ID,
      amount: 2300,
      currency: 'GTQ',
    },
    {
      id: 'vendor-payout-2',
      runId: SEEDED_RUN_ID,
      vendorId: E2E_OTHER_ORGANIZATION_ID,
      amount: 880,
      currency: 'GTQ',
    },
  ],
};

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`,
 * with the Mongo connection replaced by a driver fake and the config-service
 * fetch by a literal.
 *
 * Everything above the connection runs its real code — the routes, the guards,
 * the scope predicate and the agreement validator. That is what makes a green
 * `mock` run mean something.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.** It is
 * what `requirePermission` consults, so replacing it would make every
 * authorization assertion here vacuous — including the two that matter most,
 * that **no role** holds `settlement-management:agreement:write` or
 * `settlement-management:settlement-run:write`.
 */
const MockAppLayer = Layer.mergeAll(
  fakeMongoLayer(SEED).layer,
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
).pipe(Layer.orDie);

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['settlement'],
    router,
    appLayer: MockAppLayer,
  });
