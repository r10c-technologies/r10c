import { HttpRouter } from '@effect/platform';
import {
  CANCEL_PRODUCT_ORDER,
  FULFIL_PRODUCT_ORDER,
  ProductOrder,
} from '@r10c/business-ts-order-management';
import {
  entityMetadataRoute,
  requireCrossing,
} from '@r10c/shells-effect-service';

import { buyerCancelOrderRoute, cancelOrderRoute } from './cancel-order';
import {
  claimCancellationRoute,
  releaseCancellationClaimRoute,
  settleCancellationRoute,
} from './cancellation-steps';
import {
  byIdRoute,
  emptyPageRoute,
  guarded,
  guardedUseCase,
  listRoute,
} from './entity-crud';
import { fulfilOrderRoute } from './fulfil-order';
import { orderInScope, orderScopeFilter, orderScopeFor } from './order-scope';
import { deleteOrderRoute, placeOrderRoute } from './place-order';

/**
 * A buyer's orders — platform plane, so no route here resolves a tenant handle.
 *
 * ⚠️ **Three credentials here, and every route accepts exactly one.** The saga's
 * writes take a crossing token and no session, because the coordinator has
 * already held stock in a vendor's tenant store on the buyer's behalf and the
 * buyer holds no grant over that. The reads and the two person-facing verbs take
 * a session and no token. The buyer's own cancel takes the nonce from their
 * receipt and neither of the other two. What ADR 0023 forbids is one *route*
 * taking either, because then the weaker one is the security level
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §4).
 *
 * ⚠️ **`DELETE /api/product-order/:id` is a compensation, not a customer-facing
 * cancel.** It exists so `runSaga` can undo a written order when a later step
 * fails, and it is idempotent for the reason the reservation verbs are: delivery
 * is at-least-once and a compensation that errors on its second delivery strands
 * a saga that was in fact fully reversed
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)). A buyer
 * cancelling their own order is a status transition with its own money
 * consequences, and it is `/cancellation` below — a flow that refunds, restores
 * the stock and leaves every one of those movements its own record.
 *
 * ⚠️ **`/cancelling` and `/cancellation` are one letter apart and are not the
 * same thing.** The first is the saga's claim step, dispatched with a crossing
 * token; the second is the entry route a person reaches with a session. They are
 * named for what they do — one takes the lock, the other asks for the whole
 * cancellation — and the claim is deliberately not `PUT /status`, which would be
 * a route that can write any status from outside.
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
  // The two verbs a person can reach, each guarded by the permission its own
  // `@useCase()` derives rather than by one of the CRUD triple — there is no
  // `product-order:write` for any role and none is coming.
  HttpRouter.post(
    '/api/product-order/:id/fulfil',
    guardedUseCase(FULFIL_PRODUCT_ORDER, fulfilOrderRoute),
  ),
  HttpRouter.post(
    '/api/product-order/:id/cancellation',
    guardedUseCase(CANCEL_PRODUCT_ORDER, cancelOrderRoute),
  ),
  // The buyer's own cancel: the nonce from their receipt and nothing else. It
  // sits beside the route above rather than replacing it because the two carry
  // different credentials, and one route accepting either would make the weaker
  // one the security level (ADR 0058 §4).
  HttpRouter.post(
    '/api/product-order/:id/buyer-cancellation',
    buyerCancelOrderRoute,
  ),
  // The cancellation saga's own steps — a crossing token and no session, like
  // every other write the coordinator dispatches here.
  HttpRouter.post(
    '/api/product-order/:id/cancelling',
    requireCrossing('order-management:product-order:write')(
      claimCancellationRoute,
    ),
  ),
  HttpRouter.del(
    '/api/product-order/:id/cancelling',
    requireCrossing('order-management:product-order:write')(
      releaseCancellationClaimRoute,
    ),
  ),
  HttpRouter.post(
    '/api/product-order/:id/cancelled',
    requireCrossing('order-management:product-order:write')(
      settleCancellationRoute,
    ),
  ),
);
