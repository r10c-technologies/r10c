import { endpointGroup, entityApi } from '@entifix/service-shell';
import {
  shippingOrderApi,
  shippingOrderEndpoints,
} from '@r10c/implementation-shipping-order-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `fulfilment` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 *
 * A vendor's reads and verbs are a session bound to their organization; a
 * flow's steps — opening, holding, withdrawing, the dispatch pivot — are
 * crossings and accept no session
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/fulfilment-service', store: 'mongo' }),
  entityApi(shippingOrderApi),
  endpointGroup('fulfilment-crossings', ...shippingOrderEndpoints),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
