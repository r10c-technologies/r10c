import { HttpRouter } from '@effect/platform';
import { ProductOfferingPrice } from '@r10c/business-ts-product-configuration-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  deleteRoute,
  guarded,
  listRoute,
  saveRoute,
} from './entity-crud';

/**
 * The prices attached to a vendor's offerings — tenant plane, same store, same
 * guard.
 *
 * A separate entity and therefore a separate route surface, which is SID's
 * modelling and not an accident of layout: one offering can carry a list price
 * and a promotional one, a price per currency, a recurring price beside a
 * one-off. Folding the amount onto `ProductOffering` would make each of those a
 * second offering — the mistake that turns a subscription into a new catalog
 * entry rather than a new price.
 *
 * Plain REST throughout, for the same reason as the offering itself: nothing
 * here is assigned server-side.
 */
export const productOfferingPriceRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/product-offering-price',
    guarded(ProductOfferingPrice, 'read', () =>
      listRoute(ProductOfferingPrice),
    ),
  ),
  HttpRouter.get(
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'read', () =>
      byIdRoute(ProductOfferingPrice),
    ),
  ),
  HttpRouter.get(
    '/api/product-offering-price/$metadata',
    entityMetadataRoute(ProductOfferingPrice),
  ),
  HttpRouter.post(
    '/api/product-offering-price',
    guarded(ProductOfferingPrice, 'write', () =>
      saveRoute(ProductOfferingPrice, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'write', () =>
      saveRoute(ProductOfferingPrice, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'delete', () =>
      deleteRoute(ProductOfferingPrice),
    ),
  ),
);
