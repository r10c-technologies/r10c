import { Effect } from 'effect';

import type {
  PaymentProvider,
  PaymentRequest,
} from '../ports/payment-provider';

/** Which requests a {@link makeScriptedPaymentProvider} refuses, per step. */
export type DeclineRule = (
  request: PaymentRequest,
  step: 'authorize' | 'capture' | 'refund',
) => boolean;

/**
 * A {@link PaymentProvider} that captures everything except what `declines`
 * names, for the specs of whatever consumes the port. It runs
 * `describePaymentProviderContract`, so a refusal carries its reason the way a
 * real provider's must.
 */
export const makeScriptedPaymentProvider = (
  declines: DeclineRule = () => false,
): PaymentProvider => {
  const refused = { status: 'failed' as const, failureReason: 'declined' };
  return {
    authorize: request =>
      Effect.succeed(
        declines(request, 'authorize')
          ? refused
          : { status: 'authorized', providerReference: `ref_${request.paymentId}` },
      ),
    capture: request =>
      Effect.succeed(
        declines(request, 'capture')
          ? refused
          : { status: 'captured', providerReference: `ref_${request.paymentId}` },
      ),
    refund: request =>
      Effect.succeed(
        declines(request, 'refund')
          ? refused
          : {
              status: 'refunded',
              providerReference: `ref_refund_${request.paymentId}`,
            },
      ),
  };
};
