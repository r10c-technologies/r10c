import { HttpRouter } from '@effect/platform';
import {
  ProductCategory,
  RETIRE_PRODUCT_CATEGORY,
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

/** Categories: the other half of the classification vocabulary. Same ownership. */
export const productCategoryRoutes = HttpRouter.empty.pipe(
  HttpRouter.get('/api/product-category', listRoute(ProductCategory)),
  HttpRouter.get('/api/product-category/:id', byIdRoute(ProductCategory)),
  // A literal path, and it must stay literal: `/api/:entity/$metadata` would be
  // shadowed by the by-id route above and never run.
  HttpRouter.get(
    '/api/product-category/$metadata',
    entityMetadataRoute(ProductCategory),
  ),
  HttpRouter.post(
    '/api/product-category',
    guardedWrite(
      ProductCategory,
      'write',
      saveRoute(ProductCategory, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/product-category/:id',
    guardedWrite(
      ProductCategory,
      'write',
      saveRoute(ProductCategory, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-category/:id',
    guardedWrite(ProductCategory, 'delete', deleteRoute(ProductCategory)),
  ),
  // Literal paths, like `$metadata` above and for the same measured reason: a
  // parametric route registered beside `/:id` is shadowed by it and never runs.
  //
  // `POST` rather than `PATCH`: the body is a *selection*, not a partial
  // record, and the endpoint is a verb rather than an edit to one resource.
  // Guarded by the permission the use case derives — `retire` is not a shape
  // of `write`, which is the whole point of ADR 0026.
  HttpRouter.post(
    '/api/product-category/retire',
    guardedUseCase(
      RETIRE_PRODUCT_CATEGORY,
      retireRoute(ProductCategory, { retired: true }),
    ),
  ),
  HttpRouter.post(
    '/api/product-category/restore',
    guardedUseCase(
      RETIRE_PRODUCT_CATEGORY,
      retireRoute(ProductCategory, { retired: false }),
    ),
  ),
);
