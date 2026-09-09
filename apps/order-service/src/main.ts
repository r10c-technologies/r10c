import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * order-service — one checkout, one receipt (port 3105).
 *
 * Owns the `order` store: **platform** plane, single, one named Mongo database.
 * That is forced rather than chosen — a basket can span several vendors, and one
 * order therefore cannot live in any one vendor's tenant database. The
 * multi-vendor case rides on vendor-tagged embedded lines instead, so the buyer
 * gets one receipt and settlement still aggregates per vendor (ADR 0022).
 *
 * The cart is **not** here. It is a cookie, so the storefront's first response
 * is correct without a round trip, and the fleet keeps zero anonymous write
 * surfaces.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['order'],
  router,
  appLayer: AppLayer,
});
