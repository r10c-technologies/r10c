import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { agreementRoutes } from './routes/agreement.routes';
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
  // A literal, not `SERVICE_NAME`: `index.ts` re-exports this module, so
  // importing it back would read the constant before it is initialised.
  serviceBaseRoutes({ service: '@r10c/settlement-service', store: 'mongo' }),
  agreementRoutes,
  commissionEntryRoutes,
  settlementRunRoutes,
  vendorPayoutRoutes,
);
