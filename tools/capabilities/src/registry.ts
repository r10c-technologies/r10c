import { authnCapabilities } from './capabilities/authn.capabilities.js';
import { catalogReferenceCapabilities } from './capabilities/catalog-reference.capabilities.js';
import { marketplaceCatalogCapabilities } from './capabilities/marketplace-catalog.capabilities.js';
import { orderManagementCapabilities } from './capabilities/order-management.capabilities.js';
import { partyManagementCapabilities } from './capabilities/party-management.capabilities.js';
import { paymentManagementCapabilities } from './capabilities/payment-management.capabilities.js';
import { productConfigurationManagementCapabilities } from './capabilities/product-configuration-management.capabilities.js';
import { salesManagementCapabilities } from './capabilities/sales-management.capabilities.js';
import { settlementManagementCapabilities } from './capabilities/settlement-management.capabilities.js';
import { shippingOrderManagementCapabilities } from './capabilities/shipping-order-management.capabilities.js';
import { stockManagementCapabilities } from './capabilities/stock-management.capabilities.js';
import type { Capability } from './types.js';

/**
 * Every use case, one entry each (ADR 0080). `capabilities.spec.ts` checks this
 * list against the source tree in both directions: an `implemented` entry must
 * resolve to code, a `planned` or `in-design` one must not, and every
 * `@useCase()` and flow recipe must have an entry.
 */
export const CAPABILITIES: readonly Capability[] = [
  ...authnCapabilities,
  ...catalogReferenceCapabilities,
  ...marketplaceCatalogCapabilities,
  ...orderManagementCapabilities,
  ...partyManagementCapabilities,
  ...paymentManagementCapabilities,
  ...productConfigurationManagementCapabilities,
  ...salesManagementCapabilities,
  ...settlementManagementCapabilities,
  ...shippingOrderManagementCapabilities,
  ...stockManagementCapabilities,
];
