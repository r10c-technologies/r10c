import { entityMetadataRoute } from '@entifix/service-shell';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { HttpRouter } from 'effect/http';

import { byIdRoute, listRoute } from './entity-crud';

/**
 * The sellers' display names — **anonymous reads**, like the published
 * catalog beside them, because the storefront that renders a seller line has no
 * session. What is here is published by definition: a name and nothing else
 * (ADR 0061).
 *
 * `$metadata` must stay a literal path, or the by-id route shadows it.
 */
export const publishedVendorRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/api/published-vendor', listRoute(PublishedVendor)),
  HttpRouter.route(
    'GET',
    '/api/published-vendor/$metadata',
    entityMetadataRoute(PublishedVendor),
  ),
  HttpRouter.route(
    'GET',
    '/api/published-vendor/:id',
    byIdRoute(PublishedVendor),
  ),
]);
