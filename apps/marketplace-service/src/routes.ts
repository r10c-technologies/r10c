import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { dictionaryTermRoutes } from './routes/dictionary-term.routes';
import { productBrandRoutes } from './routes/product-brand.routes';
import { productCategoryRoutes } from './routes/product-category.routes';
import { publishedOfferingRoutes } from './routes/published-offering.routes';
import { publishedVendorRoutes } from './routes/published-vendor.routes';

/**
 * marketplace-service routes. `/api/health*` is added by the service base.
 *
 * **Reads are unauthenticated; writes are permission-gated.** That asymmetry is
 * the point of the platform plane: the storefront serves anonymous traffic and
 * must be able to read the catalog and its vocabulary without a session, while
 * only an operator authors either. A read that required a token would make the
 * storefront un-prerenderable, and a write that did not check one would let a
 * vendor rewrite the browse tree every other vendor is classified into.
 *
 * `$metadata` is the exception in the other direction: it is **always**
 * authenticated, even here. It answers "what may *you* do", so for anonymous
 * traffic the honest answer is nothing, and serving an always-empty document
 * would only add a cache key (ADR 0026).
 *
 * One module per entity, concatenated. `HttpRouter` throws on a duplicate
 * `method + path`, so composition is opt-out rather than override: a module can
 * decline to register a route (the projection registers no writes) but cannot
 * silently replace another's.
 */
export const router = Layer.mergeAll(
  // A literal, not `SERVICE_NAME`: `index.ts` re-exports this module, so
  // importing it back would read the constant before it is initialised. It
  // gains `GET /api/me` with it, which every other service already had.
  serviceBaseRoutes({ service: '@r10c/marketplace-service', store: 'mongo' }),
  publishedOfferingRoutes,
  publishedVendorRoutes,
  productBrandRoutes,
  productCategoryRoutes,
  dictionaryTermRoutes,
);
