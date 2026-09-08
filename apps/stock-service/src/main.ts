import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * stock-service — physical availability, per vendor (port 3108).
 *
 * Owns the `stock` store: tenant plane, one Mongo database per organization
 * (`stock_<organizationId>`), deliberately beside the catalog's
 * `tenant_<organizationId>` rather than inside it. A product definition is
 * owned by product-configuration-management and a quantity by stock-management,
 * so two handles are what make the one-writer rule a property of the connection
 * instead of a property of review (ADR 0020, ADR 0022).
 *
 * Quantities move only by `$inc` over the append-only `StockMovement` ledger —
 * never read-modify-write (ADR 0010).
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['stock'],
  router,
  appLayer: AppLayer,
});
