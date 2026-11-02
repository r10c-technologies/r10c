import { entityApi } from '@entifix/service-shell';
import {
  agreementApi,
  commissionEntryApi,
  settlementRunApi,
  vendorPayoutApi,
} from '@r10c/implementation-settlement-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `settlement` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * ⚠️ **Not one of them accepts a crossing token.** Every input this slice folds
 * arrives on the bus, so there is no inbound service-to-service call to
 * authenticate and no secret to hold — the fleet keeps one fewer holder of a
 * credential that can name any organization
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/settlement-service', store: 'mongo' }),
  entityApi(agreementApi),
  entityApi(commissionEntryApi),
  entityApi(vendorPayoutApi),
  entityApi(settlementRunApi),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
