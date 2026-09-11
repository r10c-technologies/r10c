import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

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
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
  HttpRouter.concat(agreementRoutes),
  HttpRouter.concat(commissionEntryRoutes),
  HttpRouter.concat(settlementRunRoutes),
  HttpRouter.concat(vendorPayoutRoutes),
);
