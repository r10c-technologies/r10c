import {
  endpointGroup,
  entityApi,
  extendFailurePolicy,
} from '@entifix/service-shell';
import {
  productOrderApi,
  productOrderEndpoints,
} from '@r10c/implementation-order-management-http';
import { FLOW_RECIPES, flowCatalog } from '@r10c/shells-effect-flow-catalog';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `order` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * Platform plane throughout: the `order` store is single-partitioned and named
 * at boot, so no endpoint here resolves a tenant handle. That is the opposite
 * of stock-service next door, and it is the store's property rather than a
 * choice — one order can span several vendors, so it cannot live in any one of
 * their databases (`docs/_shared/planes.md`).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/order-service', store: 'mongo' }),
  entityApi(productOrderApi, {
    compositions: { recipes: FLOW_RECIPES, catalog: flowCatalog },
  }),
  endpointGroup('order-cancellation', ...productOrderEndpoints),
] as const;

/**
 * How this slice's endpoints answer and log a failure (ADR 0064). A refund
 * the provider declined, met inside a cancellation, is a conflict with the
 * order as it stands — still paid for and still the buyer's — not the `402`
 * payment-service answers the coordinator that asked for it.
 */
export const policy = extendFailurePolicy(fleetFailurePolicy, {
  tagStatus: { RefundDeclined: 409 },
});
