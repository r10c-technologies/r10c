import { stockRoutes } from '@r10c/implementation-stock-management-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * stock-service routes: the base surface and the `stock-management` cell's.
 * `/api/health*` and `/api/$service` are added by the service runtime.
 *
 * Every read is a session bound to the caller's organization; the hold, its
 * two ending verbs and the restoration are crossings, and accept no session
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const router = Layer.mergeAll(
  serviceBaseRoutes({ service: '@r10c/stock-service', store: 'mongo' }),
  stockRoutes,
);
