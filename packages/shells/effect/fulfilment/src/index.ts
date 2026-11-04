/**
 * The `fulfilment` slice's shell: its routes, and the composition that binds
 * its shipping-order store to the fleet — per-organization store, crossing
 * token, the outbox and its tenant relay. fulfilment-service only mounts it
 * (ADR 0064).
 */
export {
  FULFILMENT_IDEMPOTENCY_DB,
  FULFILMENT_SLICE,
  fulfilmentComposition,
  makeAppLayer,
} from './app-layer.js';
export { endpoints, policy } from './endpoints.js';
