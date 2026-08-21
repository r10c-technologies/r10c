import { HttpRouter } from '@effect/platform';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { entityMetadataRoute } from '@r10c/shells-effect-service';

import {
  byIdRoute,
  deleteRoute,
  guardedWrite,
  listRoute,
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
);
