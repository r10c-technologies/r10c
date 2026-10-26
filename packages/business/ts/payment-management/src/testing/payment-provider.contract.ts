import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  PaymentProvider,
  PaymentProviderOutcome,
  PaymentRequest,
  RefundProviderOutcome,
} from '../ports/payment-provider';

const request = (paymentMethod: PaymentRequest['paymentMethod']) => ({
  paymentId: 'pay-1',
  orderId: 'order-1',
  amount: 40,
  currency: 'GTQ',
  paymentMethod,
});

const expectWellFormed = (
  outcome: PaymentProviderOutcome | RefundProviderOutcome,
  statuses: readonly string[],
) => {
  expect(statuses).toContain(outcome.status);
  if (outcome.status === 'failed') {
    // A refusal says why, or nobody downstream can tell a buyer anything.
    expect(outcome.failureReason).toEqual(expect.any(String));
    expect(outcome.providerReference).toBeUndefined();
  } else {
    expect(outcome.failureReason).toBeUndefined();
  }
};

/**
 * What every {@link PaymentProvider} must answer, whatever it decides: an
 * outcome from its step's vocabulary, a refusal that names its reason and
 * carries no reference, and a success that carries no refusal reason. Which
 * outcome a provider picks is its own business; the shape is the port's.
 *
 * `make` returns a provider ready to answer; run the suite once per
 * configuration that changes what it decides.
 */
export const describePaymentProviderContract = (
  name: string,
  make: () => PaymentProvider | Promise<PaymentProvider>,
) => {
  describe(`${name} honours the PaymentProvider contract`, () => {
    for (const paymentMethod of ['card', 'cash'] as const) {
      it(`answers each step for ${paymentMethod} from that step's vocabulary`, async () => {
        const provider = await make();

        expectWellFormed(
          await Effect.runPromise(provider.authorize(request(paymentMethod))),
          ['authorized', 'captured', 'failed'],
        );
        expectWellFormed(
          await Effect.runPromise(provider.capture(request(paymentMethod))),
          ['authorized', 'captured', 'failed'],
        );
        expectWellFormed(
          await Effect.runPromise(provider.refund(request(paymentMethod))),
          ['refunded', 'failed'],
        );
      });
    }
  });
};
