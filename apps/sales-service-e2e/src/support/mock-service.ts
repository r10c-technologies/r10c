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
  CheckoutCoordinatorUrl,
  CheckoutCrossingToken,
  PublishedCatalogUrl,
  router,
  seedSales,
  SERVICE_NAME,
} from '@r10c/sales-service';
import {
  LoadedConfigurationTag,
  type RunningTestService,
  serveTestService,
} from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { E2E_ORGANIZATION_ID } from './tokens';

/** The coordinator's inbound secret, as the mock profile presents it. */
const E2E_CROSSING_TOKEN = 'e2e-saga-crossing-token';

/**
 * The configuration the service would otherwise fetch from config-service at
 * boot. The values are never dialled — the connection they describe is a fake —
 * but `GET /api/config` reports them, so they stay realistic.
 *
 * ⚠️ **`tenant.dbPrefix` is `sales_`.** It is the only thing keeping the
 * `sales`, `stock` and `catalog` stores in three databases, and a copied prefix
 * here would make the mock profile model a fleet where two slices write one
 * store — a topology the real one refuses.
 */
const CONFIGURATION = {
  mongo: [{ key: 'uri', value: 'mongodb://mock/sales' }],
  tenant: [
    { key: 'dbPrefix', value: 'sales_' },
    { key: 'demoOrganizationId', value: E2E_ORGANIZATION_ID },
  ],
  jwt: [
    { key: 'publicKey', value: E2E_PUBLIC_KEY_PEM },
    { key: 'keyId', value: E2E_KEY_ID },
  ],
  // Addresses nothing dials under `mock`: the counter-sale journeys that would
  // reach them are `live`, because a saga against a fake coordinator would
  // assert that this service can compose a request and nothing about whether a
  // sale happens.
  transaction: [
    { key: 'url', value: 'http://mock-coordinator/api' },
    { key: 'crossingToken', value: E2E_CROSSING_TOKEN },
  ],
  marketplace: [{ key: 'url', value: 'http://mock-catalog/api' }],
};

/**
 * The `mock` composition root: the same shape as the service's own `AppLayer`
 * (`apps/sales-service/src/mongo.ts`), with the Mongo *connection* replaced by
 * a driver fake and the config-service fetch replaced by a literal.
 *
 * Everything above the connection is untouched — the routes, the tenant
 * resolver, the entity deserialization and the query translation all run their
 * real code. That is what makes a green `mock` run mean something.
 *
 * ⚠️ **`makeStaticPolicyDecision` is the real grant table, never a stub.** It is
 * what `requirePermission` consults, so replacing it would make every
 * authorization assertion in this suite vacuous.
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
    // The shipped layer reads all three from config-service; here they are
    // literals beside the other resolved values, and the matching entries in
    // `CONFIGURATION` are what `GET /api/config` reports.
    Layer.succeed(CheckoutCoordinatorUrl, 'http://mock-coordinator/api'),
    Layer.succeed(CheckoutCrossingToken, E2E_CROSSING_TOKEN),
    Layer.succeed(PublishedCatalogUrl, 'http://mock-catalog/api'),
  );

  // The REAL seed, so both profiles read the same channels and a shared journey
  // can name a seeded row. The fake resolves every organization to one
  // in-memory store, so the channels the specs read are the ones this wrote.
  return Layer.provideMerge(
    Layer.effectDiscard(seedSales(`sales_${E2E_ORGANIZATION_ID}`)),
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
    slices: ['sales'],
    router,
    appLayer: MockAppLayer,
  });
