import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * sales-service — how a vendor sells, per vendor (port 3109).
 *
 * Owns the `sales` store: tenant plane, one Mongo database per organization
 * (`sales_<organizationId>`), beside the catalog's `tenant_<organizationId>` and
 * stock's `stock_<organizationId>` rather than inside either. Three tenant
 * databases, three writing slices, one handle each (ADR 0020, ADR 0022).
 *
 * ⚠️ **It owns the channel, never the sale.** A counter sale is a
 * `ProductOrder` with a channel on it, written by the checkout saga through
 * order-service — the same order the storefront produces, which is what keeps a
 * vendor's takings one query instead of two
 * ([ADR 0024](../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * So this slice writes one store and no other.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['sales'],
  router,
  appLayer: AppLayer,
});
