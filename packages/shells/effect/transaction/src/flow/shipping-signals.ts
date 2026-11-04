import { Unavailable } from '@entifix/core';
import {
  EventBusTag,
  FlowEngineTag,
  type Subscription,
} from '@entifix/transactions';
import { deliveryCorrelation } from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

/**
 * A vendor's record of what the courier reported, as the delivery flow's
 * waits are answered with it: `shipping-order.delivered`, `.refused` and
 * `.returned`, each the outcome of the same name.
 */
const OUTCOME_OF: Readonly<Record<string, string>> = {
  'shipping-order.delivered': 'delivered',
  'shipping-order.refused': 'refused',
  'shipping-order.returned': 'returned',
};

/**
 * Deliveries a report may spend before it is quarantined (ADR 0030): the fleet
 * budget, each after a doubling backoff — room for a report that arrived
 * before its flow reached the wait.
 */
const MAX_ATTEMPTS = 5;

/**
 * Every `shipping-order.*` event, as one `work` queue: replicas share it, and a
 * report reaches exactly one of them. `dispatched` arrives too and is let go —
 * the delivery flow dispatched the parcel itself.
 */
export const shippingSignalsSubscription: Subscription = {
  slice: 'transaction',
  pattern: 'shipping-order.*',
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

const shipmentIdOf = (data: unknown): string | undefined => {
  const id =
    typeof data === 'object' && data !== null
      ? (data as { readonly id?: unknown }).id
      : undefined;
  return typeof id === 'string' && id !== '' ? id : undefined;
};

/**
 * Completes the delivery flow's wait with what the courier reported
 * (ADR 0070). The flow is found by its shipment, never by an id the vendor
 * would have to carry.
 *
 * - **Not parked yet** — the report arrived before the flow reached its wait
 *   — is a technical failure, so the message is redelivered and retried
 *   rather than lost.
 * - **Refused** — a report the parked wait is not answered with, or one a
 *   wait already took — is let go: a second delivery of the same report finds
 *   the wait claimed, which is the dedupe, and a `delivered` arriving after
 *   the window gave up is a report the flow no longer listens for.
 */
export const startShippingSignals = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const engine = yield* FlowEngineTag;

  yield* bus.subscribe(shippingSignalsSubscription, event => {
    const outcome = OUTCOME_OF[event.name];
    const shipmentId = shipmentIdOf(event.data);
    if (outcome === undefined || shipmentId === undefined) return Effect.void;
    return engine
      .signalCorrelated(deliveryCorrelation(shipmentId), {
        outcome,
        shipment: event.data,
      })
      .pipe(
        Effect.catchTags({
          FlowSignalRejected: () => Effect.void,
          FlowNotFound: () =>
            Effect.fail(new Unavailable({ dependency: 'delivery flow' })),
        }),
      );
  });
});
