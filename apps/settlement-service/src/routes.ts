import { requirePrincipal } from '@entifix/service-shell';
import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import { agreementRoutes } from './routes/agreement.routes';
import { configIntrospectionRoute } from './routes/config.routes';
import { settlementRunRoutes } from './routes/settlement-run.routes';
import {
  commissionEntryRoutes,
  vendorPayoutRoutes,
} from './routes/vendor-payout.routes';

/**
 * Every route this service serves, plus `/api/health*` and `/api/$service`,
 * which the shell adds.
 *
 * ⚠️ **Not one of them accepts a crossing token.** Both of this slice's inputs
 * arrive on the bus, so there is no inbound service-to-service call to
 * authenticate and no secret to hold — the fleet keeps one fewer holder of a
 * credential that can name any organization
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const router = Layer.mergeAll(
  HttpRouter.addAll([
    HttpRouter.route('GET', '/api/config', configIntrospectionRoute),
    HttpRouter.route(
      'GET',
      '/api/me',
      requirePrincipal(principal => HttpServerResponse.json(principal)),
    ),
  ]),
  agreementRoutes,
  commissionEntryRoutes,
  settlementRunRoutes,
  vendorPayoutRoutes,
);
