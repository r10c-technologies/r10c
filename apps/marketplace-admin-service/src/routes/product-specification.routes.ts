import { entityMetadataRoute } from '@entifix/service-shell';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { HttpRouter } from 'effect/http';

import {
  byIdRoute,
  createTransactionRoute,
  deleteRoute,
  guarded,
  listRoute,
  saveRoute,
} from './entity-crud';

/**
 * A vendor's own product specifications — tenant plane, so every route below
 * goes through `guarded`, which both checks the permission and binds the request
 * to the caller's organization database.
 *
 * `$metadata` is the one exception, and deliberately so: it describes the
 * *model*, not tenant data, so it takes `entityMetadataRoute` directly. Sending
 * it through `guarded` would resolve a tenant handle it never reads, and would
 * answer `409 noActiveOrganization` to a vendor who has not picked an
 * organization yet — leaving them unable to see their own affordances (ADR 0026).
 *
 * The path must stay a literal: `/api/:entity/$metadata` would be shadowed by
 * the by-id route below and never run.
 */
export const productSpecificationRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/product-specification',
    guarded(ProductSpecification, 'read', () =>
      listRoute(ProductSpecification),
    ),
  ),
  HttpRouter.route(
    'GET',
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'read', () =>
      byIdRoute(ProductSpecification),
    ),
  ),
  HttpRouter.route(
    'GET',
    '/api/product-specification/$metadata',
    entityMetadataRoute(ProductSpecification),
  ),
  HttpRouter.route(
    'POST',
    '/api/product-specification',
    guarded(ProductSpecification, 'write', organizationId =>
      createTransactionRoute(
        ProductSpecification,
        {
          key: 'product-specification',
          sequenceName: 'product-specification',
          codePrefix: 'product',
        },
        organizationId,
      ),
    ),
  ),
  HttpRouter.route(
    'PUT',
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'write', () =>
      saveRoute(ProductSpecification, { fromParams: true }),
    ),
  ),
  HttpRouter.route(
    'DELETE',
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'delete', () =>
      deleteRoute(ProductSpecification),
    ),
  ),
]);
