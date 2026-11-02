/**
 * The `marketplace-admin` slice's shell: the catalog's routes, and the
 * composition that binds its cells to the fleet — per-organization store, the
 * tenant relay and ADR 0050's rebuild walk.
 * marketplace-admin-service only mounts it, handing in its seed (ADR 0064).
 */
export {
  makeAppLayer,
  marketplaceAdminComposition,
  type MarketplaceAdminShellOptions,
} from './app-layer.js';
export { endpoints, policy } from './endpoints.js';
export { rebuildAndReport, startRebuildWalk } from './rebuild-walk.js';
