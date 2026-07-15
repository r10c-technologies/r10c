import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { Effect } from 'effect';

import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';
import { productTempData } from './product-temp-data';

/**
 * Paginate an in-memory array the way the entifix REST load adapter expects
 * (`items` / `total` / `request`).
 */
function paginate<T>(data: readonly T[], search: URLSearchParams) {
  const page = Number(search.get('page')) || 1;
  const pageSize = Number(search.get('pageSize')) || 10;
  const start = (page - 1) * pageSize;
  return {
    items: data.slice(start, start + pageSize),
    total: data.length,
    request: { page, pageSize },
  };
}

/** List endpoint: read `page`/`pageSize` from the query string, paginate. */
const list = <T>(data: readonly T[]) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(req.url, 'http://localhost').searchParams;
    return yield* HttpServerResponse.json(paginate(data, search));
  });

/** Single-record endpoint by `:id`, used when a foreign-key link is resolved. */
const byId = <T extends { id: string }>(data: readonly T[], label: string) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const found = data.find((item) => item.id === params.id);
    return found
      ? yield* HttpServerResponse.json(found)
      : yield* HttpServerResponse.json(
          { message: `${label} not found` },
          { status: 404 }
        );
  });

/**
 * marketplace-admin-service catalog routes (in-memory seed data). `/api/health`
 * is added by the service base. Live data moves to Mongo next iteration; the
 * route surface stays identical so the admin app is unaffected.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/product-category', list(productCategoryTempData)),
  HttpRouter.get(
    '/api/product-category/:id',
    byId(productCategoryTempData, 'Product category')
  ),
  HttpRouter.get('/api/product-brand', list(productBrandTempData)),
  HttpRouter.get(
    '/api/product-brand/:id',
    byId(productBrandTempData, 'Product brand')
  ),
  HttpRouter.get('/api/product', list(productTempData)),
  HttpRouter.get('/api/product/:id', byId(productTempData, 'Product'))
);
