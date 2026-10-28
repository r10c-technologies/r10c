import { makeAppLayer } from '@r10c/shells-effect-payment';

export {
  makeSimulatedPaymentProvider,
  PAYMENT_SLICE,
  router,
  SimulatedPaymentProviderLayer,
} from '@r10c/shells-effect-payment';

/** The slice's composition, as the service mounts it. */
export const AppLayer = makeAppLayer();

export const SERVICE_NAME = '@r10c/payment-service';

/**
 * `310N`, domain index 6 — the fleet's backend convention
 * (`docs/_shared/ports.md`). Reserved by ADR 0022 and claimed by the commit that
 * wrote the `payment` store.
 */
export const DEFAULT_PORT = 3106;
