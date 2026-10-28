/**
 * The `marketplace` slice's shell: the storefront's read routes, and the
 * composition that binds its three stores to the fleet — the vocabulary the
 * operator authors and the two projections it fills off the bus.
 * marketplace-service only mounts it, handing in its seed (ADR 0064).
 */
export {
  makeAppLayer,
  marketplaceComposition,
  type MarketplaceShellOptions,
} from './app-layer.js';
export { catalogSubscription, startProjecting } from './publish-catalog.js';
export {
  startProjectingVendors,
  vendorSubscription,
} from './publish-vendor.js';
export { router } from './router.js';
