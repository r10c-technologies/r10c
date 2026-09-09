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
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import {
  ReservationTtlSecondsTag,
  router,
  seedStock,
  SERVICE_NAME,
} from '@r10c/stock-service';
import { Layer } from 'effect';

import { E2E_CROSSING_TOKEN, E2E_ORGANIZATION_ID } from './tokens';

/** How long a seeded hold survives. Short enough to be visible, long enough not to expire mid-suite. */
const RESERVATION_TTL_SECONDS = 900;

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot. The values are never dialled — the connection they describe is a fake —
 * but `GET /api/config` reports them, so they stay realistic.
 *
 * ⚠️ **`tenant.dbPrefix` is `stock_`, not `tenant_`.** It is the only thing
 * keeping the `stock` and `catalog` stores in different databases, and copying
 * the catalog's value here would make the mock profile model a fleet where two
 * slices write one store — a topology the real one refuses.
 */
const CONFIGURATION = {
  mongo: [{ key: 'uri', value: 'mongodb://mock/stock' }],
  tenant: [
    { key: 'dbPrefix', value: 'stock_' },
    { key: 'demoOrganizationId', value: E2E_ORGANIZATION_ID },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  service: [{ key: 'token', value: E2E_CROSSING_TOKEN }],
  reservation: [{ key: 'ttlSeconds', value: String(RESERVATION_TTL_SECONDS) }],
};

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`
 * (`apps/stock-service/src/mongo.ts`), with the Mongo *connection* replaced by
 * a driver fake and the config-service fetch replaced by a literal.
 *
 * Everything above the connection is untouched — the routes, the tenant
 * resolver, the movement's transaction, the conditional reservation write and
 * the unique index all run their real code. That is what makes a green `mock`
 * run mean something.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.** It
 * is what `requirePermission` consults, so replacing it would make every
 * authorization assertion in this suite vacuous — including the one that
 * matters most here, that no role holds `stock-management:reservation:write`.
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
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
    fakeConfigurationLayer(CONFIGURATION),
    Layer.succeed(LoadedConfigurationTag, CONFIGURATION),
    // The shipped layer reads both from config-service; here they are literals
    // beside the other resolved values. The matching entries in
    // `CONFIGURATION` are what `GET /api/config` reports.
    Layer.succeed(ServiceCrossingTokenTag, E2E_CROSSING_TOKEN),
    Layer.succeed(ReservationTtlSecondsTag, RESERVATION_TTL_SECONDS),
  );

  // The REAL seed, so both profiles read the same stock positions and a shared
  // journey can name a seeded row. The fake resolves every organization to one
  // in-memory store, so the positions the specs read are the ones this wrote.
  return Layer.provideMerge(
    Layer.effectDiscard(seedStock(`stock_${E2E_ORGANIZATION_ID}`)),
    connections,
  ).pipe(Layer.orDie);
})();

/** Boots the service's real router in-process, on an ephemeral port. */
export const startMockService = (): Promise<RunningTestService> =>
  serveTestService({
    name: SERVICE_NAME,
    // Overridden by `serveTestService`, which binds an ephemeral port.
    port: 0,
    // The same slice the real process hosts, so `/api/$service` describes the
    // thing under test rather than a reduced version of it.
    slices: ['stock'],
    router,
    appLayer: MockAppLayer,
  });
