export { AppLayer } from './mongo';
export { PAYMENT_COLLECTION, PAYMENT_SLICE, REFUND_COLLECTION } from './outbox';
export { ensurePaymentIndexes, PaymentIndexesLayer } from './payment-index';
export {
  makeSimulatedPaymentProvider,
  SimulatedPaymentProviderLayer,
} from './providers/simulated';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/payment-service';

/**
 * `310N`, domain index 6 — the fleet's backend convention
 * (`docs/_shared/ports.md`). Reserved by ADR 0022 and claimed by the commit that
 * wrote the `payment` store.
 */
export const DEFAULT_PORT = 3106;
