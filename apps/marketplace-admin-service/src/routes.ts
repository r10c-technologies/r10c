import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { productSpecificationRoutes } from './routes/product-specification.routes';
import { sagaRoutes } from './saga/routes';

/**
 * marketplace-admin-service routes: the catalog, plus the co-deployed
 * `transaction` slice's saga surface. `/api/health*` is added by the service
 * base.
 *
 * Paths are literals that match each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name. One module per entity, concatenated; `HttpRouter` throws on a
 * duplicate `method + path`, so a module can decline to register a route but can
 * never silently replace another's.
 */
export const router = sagaRoutes(HttpRouter.empty).pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),

  HttpRouter.concat(productSpecificationRoutes),
);
