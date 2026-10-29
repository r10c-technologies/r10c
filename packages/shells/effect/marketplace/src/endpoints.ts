import { entityApi } from '@entifix/service-shell';
import {
  dictionaryTermApi,
  productBrandApi,
  productCategoryApi,
} from '@r10c/implementation-catalog-reference-http';
import { publishedOfferingApi } from '@r10c/implementation-marketplace-catalog-http';
import { publishedVendorApi } from '@r10c/implementation-marketplace-vendor-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `marketplace` slice's endpoints, served as one `HttpApi` by
 * `makeService` ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * **Reads are unauthenticated; writes are permission-gated.** That asymmetry
 * is the point of the platform plane: the storefront serves anonymous traffic
 * and must be able to read the catalog and its vocabulary without a session,
 * while only an operator authors either. A read that required a token would
 * make the storefront un-prerenderable, and a write that did not check one
 * would let a vendor rewrite the browse tree every other vendor is classified
 * into.
 *
 * `$metadata` is the exception in the other direction: it is **always**
 * authenticated, even here. It answers "what may *you* do", so for anonymous
 * traffic the honest answer is nothing, and serving an always-empty document
 * would only add a cache key (ADR 0026).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/marketplace-service', store: 'mongo' }),
  entityApi(publishedOfferingApi),
  entityApi(publishedVendorApi),
  entityApi(dictionaryTermApi),
  entityApi(productBrandApi),
  entityApi(productCategoryApi),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
