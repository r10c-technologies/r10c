import { HttpRouter } from '@effect/platform';
import {
  ProductBrand,
  RETIRE_PRODUCT_BRAND,
} from '@r10c/business-ts-catalog-reference';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  deleteRoute,
  guardedUseCase,
  guardedWrite,
  listRoute,
  retireRoute,
  saveRoute,
} from './entity-crud';

/**
 * Brands: part of the vocabulary a marketplace catalog is classified in.
 * Operator-authored, read by everyone — including anonymous storefront traffic,
 * which is why the reads carry no guard. They were per-vendor rows in the tenant
 * plane until ADR 0022; a browse tree cannot merge two vendors' private
 * "Electronics", so a marketplace has to own them centrally.
 */
export const productBrandRoutes = HttpRouter.empty.pipe(
  HttpRouter.get('/api/product-brand', listRoute(ProductBrand)),
  HttpRouter.get('/api/product-brand/:id', byIdRoute(ProductBrand)),
  // A literal path, and it must stay literal: `/api/:entity/$metadata` would be
  // shadowed by the by-id route above and never run.
  HttpRouter.get(
    '/api/product-brand/$metadata',
    entityMetadataRoute(ProductBrand),
  ),
  HttpRouter.post(
    '/api/product-brand',
    guardedWrite(
      ProductBrand,
      'write',
      saveRoute(ProductBrand, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/product-brand/:id',
    guardedWrite(
      ProductBrand,
      'write',
      saveRoute(ProductBrand, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-brand/:id',
    guardedWrite(ProductBrand, 'delete', deleteRoute(ProductBrand)),
  ),
  // Literal paths, like `$metadata` above and for the same measured reason: a
  // parametric route registered beside `/:id` is shadowed by it and never runs.
  //
  // `POST` rather than `PATCH`: the body is a *selection*, not a partial
  // record, and the endpoint is a verb rather than an edit to one resource.
  // Guarded by the permission the use case derives — `retire` is not a shape
  // of `write`, which is the whole point of ADR 0026.
  HttpRouter.post(
    '/api/product-brand/retire',
    guardedUseCase(
      RETIRE_PRODUCT_BRAND,
      retireRoute(ProductBrand, { retired: true }),
    ),
  ),
  HttpRouter.post(
    '/api/product-brand/restore',
    guardedUseCase(
      RETIRE_PRODUCT_BRAND,
      retireRoute(ProductBrand, { retired: false }),
    ),
  ),
);
