/**
 * The `sales` slice's shell: its routes, and the composition that binds its
 * cells to the fleet — per-organization store, the coordinator a counter sale
 * starts the checkout through, and the published prices it re-prices from.
 * sales-service only mounts it, handing in its seed (ADR 0064).
 */
export {
  makeAppLayer,
  salesComposition,
  type SalesShellOptions,
} from './app-layer.js';
export { router } from './router.js';
