import { HttpRouter } from '@effect/platform';
import {
  ProductOffering,
  PUBLISH_PRODUCT_OFFERING,
  UNPUBLISH_PRODUCT_OFFERING,
} from '@r10c/business-ts-product-configuration-management';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  deleteRoute,
  guarded,
  guardedUseCase,
  listRoute,
  preserveOfferingLifecycle,
  saveRoute,
  transitionOfferingRoute,
} from './entity-crud';

/**
 * A vendor's own commercial offerings — tenant plane, so every route goes
 * through `guarded` or `guardedUseCase`, each of which checks the permission
 * *and* binds the request to the caller's organization database.
 *
 * **`POST` is a plain REST create, not the command protocol**, which is the one
 * way this module differs from `product-specification.routes.ts`. A
 * specification is created transactionally because a Redis sequence assigns its
 * `code` server-side, and drawing from that sequence is the non-transactional
 * side effect the saga exists to coordinate. An offering has no server-owned
 * member: every value on it comes from the vendor. Running it through the
 * accept/execute split would buy nothing and cost a `202`, a tracker record and
 * an outbox entry per create.
 *
 * `$metadata` is the exception every entity makes, and for ADR 0026's stated
 * reason: it describes the *model* rather than tenant data, so it must not
 * resolve a tenant handle and must not answer `409` to a vendor who has not
 * picked an organization yet. Its path stays a **literal** — registered as
 * `/api/:entity/$metadata` it would be shadowed by the by-id route below and
 * silently never run, which reads as "this entity has no metadata".
 *
 * `publish` and `unpublish` are `POST`s on a sub-path rather than a `PUT` of a
 * status field, because they are the verbs ADR 0026 exists for: they carry
 * their own permission, and a route guarded by `write` would let anyone who can
 * edit a draft put it in front of buyers.
 */
export const productOfferingRoutes = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/product-offering',
    guarded(ProductOffering, 'read', () => listRoute(ProductOffering)),
  ),
  HttpRouter.get(
    '/api/product-offering/:id',
    guarded(ProductOffering, 'read', () => byIdRoute(ProductOffering)),
  ),
  HttpRouter.get(
    '/api/product-offering/$metadata',
    entityMetadataRoute(ProductOffering),
  ),
  HttpRouter.post(
    '/api/product-offering',
    guarded(ProductOffering, 'write', () =>
      saveRoute(ProductOffering, {
        fromParams: false,
        prepare: preserveOfferingLifecycle,
      }),
    ),
  ),
  HttpRouter.put(
    '/api/product-offering/:id',
    guarded(ProductOffering, 'write', () =>
      saveRoute(ProductOffering, {
        fromParams: true,
        prepare: preserveOfferingLifecycle,
      }),
    ),
  ),
  HttpRouter.del(
    '/api/product-offering/:id',
    guarded(ProductOffering, 'delete', () => deleteRoute(ProductOffering)),
  ),
  HttpRouter.post(
    '/api/product-offering/:id/publish',
    guardedUseCase(PUBLISH_PRODUCT_OFFERING, organizationId =>
      transitionOfferingRoute('publish', organizationId),
    ),
  ),
  HttpRouter.post(
    '/api/product-offering/:id/unpublish',
    guardedUseCase(UNPUBLISH_PRODUCT_OFFERING, organizationId =>
      transitionOfferingRoute('unpublish', organizationId),
    ),
  ),
);
