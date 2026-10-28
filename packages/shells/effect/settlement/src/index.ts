/**
 * The `settlement` slice's shell: its routes, and the composition that binds
 * its ledger to the fleet — the store, the four-message fold, the settlement
 * sweep and the relay. settlement-service only mounts it, handing in its seed
 * (ADR 0064).
 */
export {
  ensureBusIndexes,
  makeAppLayer,
  SETTLEMENT_SLICE,
  settlementComposition,
  type SettlementShellOptions,
} from './app-layer.js';
export { logFoldReport, startSettlementFold } from './fold-subscriptions.js';
export { router } from './router.js';
export {
  SettlementRunIntervalMs,
  settleOncePass,
  startSettlementSweep,
} from './run-sweep.js';
