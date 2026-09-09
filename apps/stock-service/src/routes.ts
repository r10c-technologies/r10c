import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { reservationRoutes } from './routes/reservation.routes';
import { stockItemRoutes } from './routes/stock-item.routes';
import { stockMovementRoutes } from './routes/stock-movement.routes';

/**
 * stock-service routes. `/api/health*` and `/api/$service` are added by the
 * service base.
 *
 * **Every route is authenticated and organization-scoped.** Unlike
 * marketplace-service, nothing here is readable anonymously: this is tenant
 * storage, and the whole of a vendor's stock position is exactly what a
 * competitor would want. What the storefront shows about availability is a
 * *projection* and a hint, never a live read of this service
 * ([ADR 0010](../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * Paths are literals that match each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name. One module per entity, concatenated; `HttpRouter` throws on a
 * duplicate `method + path`, so a module can decline to register a route but can
 * never silently replace another's.
 *
 * ⚠️ **`POST /api/reservation` is the exception to the first paragraph**, and
 * the only one. It is a platform-plane caller acting for an organization it was
 * *handed* rather than one it picked — checkout, whose buyer holds no session
 * organization — so it is authorized by a service token plus
 * `stock-management:reservation:write` and an explicit `x-organization-id`, and
 * it accepts no session at all
 * ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 * The reservation *reads* beside it stay session-guarded and organization-scoped
 * like everything else here; see `reservation.routes.ts` for why that is not the
 * two-credentials mistake.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),

  HttpRouter.concat(stockItemRoutes),
  HttpRouter.concat(reservationRoutes),
  HttpRouter.concat(stockMovementRoutes),
);
