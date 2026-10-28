import {
  configurationLookupRoutes,
  configurationRoutes,
} from '@r10c/implementation-configuration-http';
import { Layer } from 'effect';

/**
 * The `config` slice's routes. `/api/health` is added by the service runtime.
 *
 * - `/api/config…` — the fleet's lookup and the store's introspection, behind
 *   the shared fleet token, with real values. See
 *   `@r10c/implementation-configuration-http`'s `configurationLookupRoutes`.
 * - `/api/configuration…` — the operator-facing CRUD, behind
 *   `config:configuration:*`, blanking secrets.
 */
export const router = Layer.mergeAll(
  configurationLookupRoutes,
  configurationRoutes,
);
