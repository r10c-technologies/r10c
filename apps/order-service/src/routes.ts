import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { productOrderRoutes } from './routes/product-order.routes';

/**
 * order-service routes. `/api/health*` and `/api/$service` are added by the
 * shell.
 *
 * Platform plane throughout: the `order` store is single-partitioned and named
 * at boot, so no route here resolves a tenant handle. That is the opposite of
 * stock-service next door, and it is the store's property rather than a choice —
 * one order can span several vendors, so it cannot live in any one of their
 * databases (`docs/_shared/planes.md`).
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
  HttpRouter.concat(productOrderRoutes),
);
