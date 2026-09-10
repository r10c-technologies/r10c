import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { counterSaleRoutes } from './routes/counter-sale';
import { salesChannelRoutes } from './routes/sales-channel.routes';

/**
 * sales-service routes. `/api/health*` and `/api/$service` are added by the
 * service base.
 *
 * **Every route is authenticated and organization-scoped.** A vendor's channel
 * list is tenant storage: one vendor's counter means nothing to another, and no
 * reader outside the owning organization has any use for it
 * ([ADR 0024](../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * Paths are literals matching each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name. `HttpRouter` throws on a duplicate `method + path`, so a
 * module can decline to register a route but can never silently replace
 * another's.
 *
 * ⚠️ **`POST /api/counter-sale` is a write this slice does not persist.** It
 * starts the checkout saga, which reserves stock, writes the order and captures
 * the payment through the slices that own those stores. "A slice writes only the
 * Stores it owns" holds unamended
 * ([ADR 0056](../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),

  HttpRouter.concat(salesChannelRoutes),
).pipe(counterSaleRoutes);
