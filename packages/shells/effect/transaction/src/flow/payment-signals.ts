import { Unavailable } from '@entifix/core';
import {
  EventBusTag,
  FlowEngineTag,
  type Subscription,
} from '@entifix/transactions';
import { confirmedBySeller } from '@r10c/business-ts-sales-vocabulary';
import { paymentCorrelation } from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

/**
 * The order events a payment-link order's wait is answered with: the seller's
 * confirmation, and the cancellation an expiry or a withdrawal announces.
 */
const OUTCOME_OF: Readonly<Record<string, string>> = {
  'order.payment-confirmed': 'confirmed',
  'order.cancelled': 'cancelled',
};

/**
 * Deliveries an answer may spend before it is quarantined (ADR 0030): room for
 * a confirmation that landed between the order's commit point and its flow
 * parking on the wait.
 */
const MAX_ATTEMPTS = 5;

/**
 * Both events on one `work` queue, as the delivery flow's reports are:
 * replicas share it, and an answer reaches exactly one of them (ADR 0081 §4).
 */
export const paymentSignalsSubscription: Subscription = {
  slice: 'transaction',
  pattern: 'order.*',
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

type OrderFacts = {
  readonly groupId?: unknown;
  readonly vendorId?: unknown;
  readonly paymentMethod?: unknown;
  readonly paymentReference?: unknown;
};

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * Completes a payment-link order's wait with what became of it. The flow is
 * found by the order's group and vendor — known when the checkout was
 * composed, unlike the order's own id — never by anything the seller carries.
 *
 * - **Not parked yet**, for an order paid by link, is a technical failure: the
 *   message is redelivered and retried rather than lost.
 * - **Any other order** never waits, so an event about one is let go — which
 *   is every cancellation that is not a link's.
 * - **Refused** — a wait already answered — is let go: a second delivery finds
 *   the wait claimed, which is the dedupe.
 */
export const startPaymentSignals = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const engine = yield* FlowEngineTag;

  yield* bus.subscribe(paymentSignalsSubscription, event => {
    const outcome = OUTCOME_OF[event.name];
    const order = (event.data ?? {}) as OrderFacts;
    if (
      outcome === undefined ||
      !filled(order.groupId) ||
      !filled(order.vendorId) ||
      !filled(order.paymentMethod) ||
      !confirmedBySeller(order.paymentMethod)
    ) {
      return Effect.void;
    }
    return engine
      .signalCorrelated(paymentCorrelation(order.groupId, order.vendorId), {
        outcome,
        // The wait provides it to the step that records the payment, which
        // reads the number from the flow and never from the order (ADR 0081 §2).
        ...(filled(order.paymentReference)
          ? { paymentReference: order.paymentReference }
          : {}),
      })
      .pipe(
        Effect.catchTags({
          FlowSignalRejected: () => Effect.void,
          FlowNotFound: () =>
            Effect.fail(new Unavailable({ dependency: 'checkout flow' })),
        }),
      );
  });
});
