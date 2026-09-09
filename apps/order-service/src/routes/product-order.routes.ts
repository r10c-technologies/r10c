import { HttpRouter } from '@effect/platform';
import { ProductOrder } from '@r10c/business-ts-order-management';
import {
  entityMetadataRoute,
  requireCrossing,
} from '@r10c/shells-effect-service';

import { byIdRoute, emptyPageRoute, guarded, listRoute } from './entity-crud';
import {
  orderInScope,
  orderScopeFilter,
  orderScopeFor,
} from './order-scope';
import { deleteOrderRoute, placeOrderRoute } from './place-order';

/**
 * A buyer's orders — platform plane, so no route here resolves a tenant handle.
 *
 * ⚠️ **The two writes take a crossing token and no session; the reads take a
 * session and no token.** They are different acts. Writing an order is a saga
 * step: the coordinator has already held stock in a vendor's tenant store on
 * the buyer's behalf, and the buyer holds no grant over that. Reading an order
 * is an ordinary authenticated read. Each route accepts exactly one credential,
 * which is the distinction ADR 0023 draws — what it forbids is one *route*
 * taking either, because then the weaker one is the security level.
 *
 * ⚠️ **`DELETE` is a compensation, not a customer-facing cancel.** It exists so
 * `runSaga` can undo a written order when a later step fails, and it is
 * idempotent for the reason the reservation verbs are: delivery is at-least-once
 * and a compensation that errors on its second delivery strands a saga that was
 * in fact fully reversed ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)).
 * A buyer cancelling their own order is a status transition with its own money
 * consequences, and it is not this.
 *
 * ⚠️ **Both reads are scoped to the caller, and the scope comes from the
 * verified principal.** This store is platform plane, so there is no tenant
 * handle doing the isolation and the predicate is the whole boundary: an
 * operator reads every order, a vendor the orders that owe them a line, and
 * anybody else only what they placed (`order-scope.ts`). It is deliberately not
 * expressed as a query — `buyerId` is `filterable`, so a client that could scope
 * itself could scope itself to somebody else.
 *
 * `$metadata` stays a **literal** registered before `/:id`: as
 * `/api/:entity/$metadata` it is shadowed by the by-id route and silently never
 * runs, which reads as "this entity has no metadata" (ADR 0026).
 */
export const productOrderRoutes = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/api/product-order',
    requireCrossing('order-management:product-order:write')(placeOrderRoute),
  ),
  HttpRouter.get(
    '/api/product-order',
    guarded(ProductOrder, 'read', principal => {
      const scope = orderScopeFor(principal);
      // A caller whose own records cannot be identified reads an empty page
      // without touching Mongo, rather than a predicate spelled to match
      // nothing.
      return scope.kind === 'nothing'
        ? emptyPageRoute(ProductOrder)
        : listRoute(ProductOrder, orderScopeFilter(scope));
    }),
  ),
  HttpRouter.get(
    '/api/product-order/$metadata',
    entityMetadataRoute(ProductOrder),
  ),
  HttpRouter.get(
    '/api/product-order/:id',
    guarded(ProductOrder, 'read', principal => {
      const scope = orderScopeFor(principal);
      return byIdRoute(ProductOrder, order => orderInScope(scope, order));
    }),
  ),
  HttpRouter.del(
    '/api/product-order/:id',
    requireCrossing('order-management:product-order:delete')(deleteOrderRoute),
  ),
);
