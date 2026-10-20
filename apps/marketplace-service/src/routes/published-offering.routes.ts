import { entityMetadataRoute } from '@entifix/service-shell';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { HttpRouter } from 'effect/http';

import { byIdRoute, listRoute } from './entity-crud';

/**
 * The published catalog: read-only over HTTP by construction. Its only writer is
 * the projector that consumes `catalog.published`, so exposing a POST here would
 * create a second writer for a projection — the one thing `truth: projection-of:`
 * forbids. That is why this module composes two of the CRUD helpers and not the
 * other three, rather than registering guarded writes nobody may pass.
 */
export const publishedOfferingRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/published-offering',
    listRoute(PublishedOffering),
  ),
  HttpRouter.route(
    'GET',
    '/api/published-offering/:id',
    byIdRoute(PublishedOffering),
  ),
  HttpRouter.route(
    'GET',
    '/api/published-offering/$metadata',
    entityMetadataRoute(PublishedOffering),
  ),
]);
