/**
 * The `stock` slice's shell: its routes, and the composition that binds its
 * ledger to the fleet — per-organization store, crossing token and the
 * reservation reaper. stock-service only mounts it, handing in its seed
 * (ADR 0064).
 */
export {
  makeAppLayer,
  stockComposition,
  type StockShellOptions,
} from './app-layer.js';
export {
  startReservationSweep,
  sweepExpiredHolds,
} from './reservation-sweep.js';
export { router } from './router.js';
