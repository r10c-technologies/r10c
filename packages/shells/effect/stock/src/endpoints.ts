import { endpointGroup, entityApi } from '@entifix/service-shell';
import {
  reservationApi,
  stockCrossingEndpoints,
  stockItemApi,
  stockMovementApi,
} from '@r10c/implementation-stock-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `stock` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * Every read is a session bound to the caller's organization; the hold, its
 * two endings and the restoration are crossings, and accept no session
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/stock-service', store: 'mongo' }),
  entityApi(stockItemApi),
  entityApi(stockMovementApi),
  entityApi(reservationApi),
  endpointGroup('stock-crossings', ...stockCrossingEndpoints),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
