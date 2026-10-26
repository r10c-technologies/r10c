import { catalogRoutes } from '@r10c/implementation-product-configuration-management-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * marketplace-admin-service routes: the catalog. `/api/health*` is added by the
 * service base.
 *
 * The co-deployed `transaction` slice's saga surface used to be mounted here
 * too. It moved to transaction-service on `:3103` when ADR 0039's stated
 * trigger fired (#229) — this process still publishes `transaction.*` through
 * its outbox, and the browser reaches the tracker through its own same-origin
 * proxy rather than this one.
 *
 * Paths are literals that match each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name. One module per entity, concatenated; `HttpRouter` throws on a
 * duplicate `method + path`, so a module can decline to register a route but can
 * never silently replace another's.
 */
export const router = Layer.mergeAll(
  // A literal, not `SERVICE_NAME`: `index.ts` re-exports this module, so
  // importing it back would read the constant before it is initialised.
  serviceBaseRoutes({
    service: '@r10c/marketplace-admin-service',
    store: 'mongo',
  }),
  catalogRoutes,
);
