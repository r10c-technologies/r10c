import { entityMetadataRoute } from '@entifix/service-shell';
import { ProductOfferingPrice } from '@r10c/business-ts-product-configuration-management';
import { HttpRouter } from 'effect/http';

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
export const productOfferingPriceRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/product-offering-price',
    guarded(ProductOfferingPrice, 'read', () =>
      listRoute(ProductOfferingPrice),
    ),
  ),
  HttpRouter.route(
    'GET',
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'read', () =>
      byIdRoute(ProductOfferingPrice),
    ),
  ),
  HttpRouter.route(
    'GET',
    '/api/product-offering-price/$metadata',
    entityMetadataRoute(ProductOfferingPrice),
  ),
  HttpRouter.route(
    'POST',
    '/api/product-offering-price',
    guarded(ProductOfferingPrice, 'write', () =>
      saveRoute(ProductOfferingPrice, { fromParams: false }),
    ),
  ),
  HttpRouter.route(
    'PUT',
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'write', () =>
      saveRoute(ProductOfferingPrice, { fromParams: true }),
    ),
  ),
  HttpRouter.route(
    'DELETE',
    '/api/product-offering-price/:id',
    guarded(ProductOfferingPrice, 'delete', () =>
      deleteRoute(ProductOfferingPrice),
    ),
  ),
]);
