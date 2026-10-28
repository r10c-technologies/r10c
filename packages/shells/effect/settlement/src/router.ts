import { settlementRoutes } from '@r10c/implementation-settlement-management-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * Every route this service serves, plus `/api/health*` and `/api/$service`,
 * which the shell adds.
 *
 * ⚠️ **Not one of them accepts a crossing token.** Both of this slice's inputs
 * arrive on the bus, so there is no inbound service-to-service call to
 * authenticate and no secret to hold — the fleet keeps one fewer holder of a
 * credential that can name any organization
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const router = Layer.mergeAll(
  serviceBaseRoutes({ service: '@r10c/settlement-service', store: 'mongo' }),
  settlementRoutes,
);
