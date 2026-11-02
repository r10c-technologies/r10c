/**
 * The `payment` slice's shell: its routes, and the composition that binds its
 * cells to the fleet — the ledger, the bus, the relay and the simulated
 * provider behind `PaymentProviderTag`. payment-service only mounts it
 * (ADR 0064).
 */
export {
  makeAppLayer,
  PAYMENT_SLICE,
  paymentComposition,
} from './app-layer.js';
export { endpoints, policy } from './endpoints.js';
export {
  DEFAULT_SIMULATED_SETTINGS,
  makeSimulatedPaymentProvider,
  readSimulatedOutcome,
  SimulatedPaymentProviderLayer,
} from './simulated-provider.js';
