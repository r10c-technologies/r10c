import { entityApi } from '@entifix/service-shell';
import { salesChannelApi } from '@r10c/implementation-sales-management-http';
import { FLOW_RECIPES, flowCatalog } from '@r10c/shells-effect-flow-catalog';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `sales` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * **Every endpoint is authenticated and organization-scoped.** A vendor's
 * channel list is tenant storage: one vendor's counter means nothing to
 * another, and no reader outside the owning organization has any use for it
 * ([ADR 0024](../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/sales-service', store: 'mongo' }),
  entityApi(salesChannelApi, {
    compositions: { recipes: FLOW_RECIPES, catalog: flowCatalog },
  }),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
