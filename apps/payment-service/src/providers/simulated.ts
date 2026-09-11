import {
  type PaymentProvider,
  type PaymentProviderOutcome,
  PaymentProviderTag,
  type PaymentRequest,
  type RefundProviderOutcome,
} from '@r10c/business-ts-payment-management';
import { Effect, Layer } from 'effect';

/**
 * How the simulated adapter should answer. From config-service, so a live pass
 * can force a refusal without editing code or restarting into a debugger.
 */
export interface SimulatedProviderSettings {
  /**
   * `capture` (the default), `authorize` — answer `authorized` and stop there,
   * the *contra entrega* shape — or `decline`.
   */
  readonly outcome: 'capture' | 'authorize' | 'decline';
  /** What a declined attempt reports. */
  readonly declineReason: string;
}

export const DEFAULT_SIMULATED_SETTINGS: SimulatedProviderSettings = {
  outcome: 'capture',
  declineReason: 'simulated decline',
};

/** Narrow a configured string to a settable outcome, defaulting to `capture`. */
export const readSimulatedOutcome = (
  value: string,
): SimulatedProviderSettings['outcome'] =>
  value === 'authorize' || value === 'decline' ? value : 'capture';

/**
 * A provider reference that looks like one and is derived rather than random.
 *
 * ⚠️ Derived from the payment id **on purpose**. A random reference would make
 * a replayed capture produce a different one each time, which is precisely the
 * property a reconciliation uses to tell one attempt from two — so a random one
 * would make the simulator disagree with every real provider about the thing the
 * field exists for.
 */
const reference = (paymentId: string): string => `sim_${paymentId}`;

/**
 * A refund's own reference, which is deliberately not the capture's.
 *
 * A real provider issues a second identifier for the money going back, and a
 * reconciliation joins on both. Reusing the capture's would make the two
 * indistinguishable in exactly the place that has to tell them apart.
 */
const refundReference = (paymentId: string): string =>
  `sim_refund_${paymentId}`;

/**
 * Money going back.
 *
 * A refund has no authorization step to skip and no `authorize` setting to
 * honour: the money already moved, and the only question is whether it comes
 * back. Cash included — a drawer that can take money can give it back.
 */
const answerRefund = (
  settings: SimulatedProviderSettings,
  request: PaymentRequest,
): RefundProviderOutcome =>
  settings.outcome === 'decline'
    ? { status: 'failed', failureReason: settings.declineReason }
    : {
        status: 'refunded',
        providerReference:
          request.paymentMethod === 'cash'
            ? undefined
            : refundReference(request.paymentId),
      };

const answer = (
  settings: SimulatedProviderSettings,
  request: PaymentRequest,
  step: 'authorize' | 'capture',
): PaymentProviderOutcome => {
  if (settings.outcome === 'decline') {
    return { status: 'failed', failureReason: settings.declineReason };
  }

  // Cash never has an authorization step: the money is already in the drawer,
  // so a counter payment goes straight to `captured`. The status vocabulary
  // says so and this is where it becomes behaviour.
  if (request.paymentMethod === 'cash') {
    return { status: 'captured', providerReference: undefined };
  }

  if (step === 'authorize' || settings.outcome === 'authorize') {
    return {
      status: 'authorized',
      providerReference: reference(request.paymentId),
    };
  }

  return {
    status: 'captured',
    providerReference: reference(request.paymentId),
  };
};

/**
 * The v1 adapter: deterministic, offline, and honest about what it does not do.
 *
 * It is a **simulator, not a stub**. It answers through the same port a live
 * provider will, distinguishes authorization from capture, and never throws —
 * so the failure branches the saga's pivot depends on are exercised by real
 * code rather than asserted by a mock. What it does not do is move money,
 * settle, or have an opinion about a card number.
 */
export const makeSimulatedPaymentProvider = (
  settings: SimulatedProviderSettings,
): PaymentProvider => ({
  authorize: request => Effect.succeed(answer(settings, request, 'authorize')),
  capture: request => Effect.succeed(answer(settings, request, 'capture')),
  refund: request => Effect.succeed(answerRefund(settings, request)),
});

export const SimulatedPaymentProviderLayer = (
  settings: SimulatedProviderSettings,
): Layer.Layer<PaymentProviderTag> =>
  Layer.succeed(PaymentProviderTag, makeSimulatedPaymentProvider(settings));
