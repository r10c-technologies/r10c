import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { paymentRoutes } from './routes/payment.routes';

/**
 * payment-service routes. `/api/health*` and `/api/$service` are added by the
 * shell.
 *
 * Platform plane throughout: the `payment` store is single-partitioned and named
 * at boot, so no route here resolves a tenant handle. A payment belongs to an
 * order, and an order can span several vendors — so it could not live in any one
 * of their tenant databases even if it wanted to (`docs/_shared/planes.md`).
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
  HttpRouter.concat(paymentRoutes),
);
