import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { productOfferingRoutes } from './routes/product-offering.routes';
import { productOfferingPriceRoutes } from './routes/product-offering-price.routes';
import { productSpecificationRoutes } from './routes/product-specification.routes';

/**
 * marketplace-admin-service routes: the catalog. `/api/health*` is added by the
 * service base.
 *
 * The co-deployed `transaction` slice's saga surface used to be mounted here
 * too. It moved to transaction-service on `:3103` when ADR 0039's stated
 * trigger fired (#229) — this process still publishes `transaction.*` through
 * its outbox, and the browser reaches the tracker through its own same-origin
 * proxy rather than this one.
 *
 * Paths are literals that match each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name. One module per entity, concatenated; `HttpRouter` throws on a
 * duplicate `method + path`, so a module can decline to register a route but can
 * never silently replace another's.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),

  HttpRouter.concat(productSpecificationRoutes),
  HttpRouter.concat(productOfferingRoutes),
  HttpRouter.concat(productOfferingPriceRoutes),
);
