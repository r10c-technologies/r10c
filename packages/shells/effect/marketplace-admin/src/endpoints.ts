import { entityApi } from '@entifix/service-shell';
import {
  productOfferingApi,
  productOfferingPriceApi,
  productSpecificationApi,
} from '@r10c/implementation-product-configuration-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `marketplace-admin` slice's endpoints, served as one `HttpApi` by
 * `makeService` ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * A vendor's catalog: every endpoint a session bound to that vendor's
 * organization and resolved to its own `tenant_<id>` database.
 */
export const endpoints = [
  serviceBaseGroup({
    service: '@r10c/marketplace-admin-service',
    store: 'mongo',
  }),
  entityApi(productSpecificationApi),
  entityApi(productOfferingApi),
  entityApi(productOfferingPriceApi),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
