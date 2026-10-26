import { queueNameFor } from '@entifix/amqp/transactions';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import { ProductOrderStoreTag } from '@r10c/business-ts-order-management';
import {
  PAYMENT_CAPTURED,
  readPaymentOutcome,
} from '@r10c/business-ts-payment-contracts';
import { Effect } from 'effect';

/** Redeliveries before a capture this service cannot fold is quarantined. */
const MAX_ATTEMPTS = 5;

/**
 * `payment.captured`, on this slice's own durable queue. `work`, because a
 * capture must advance its order exactly once whichever replica receives it.
 */
export const capturedSubscription: Subscription = {
  slice: 'order',
  pattern: PAYMENT_CAPTURED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

/**
 * Advance an order to `paid` when its capture is announced.
 *
 * The capture *decision* never arrives as a message — the saga dispatches it
 * to payment-service — so what this folds is the consequence. The store claims
 * the event in the same unit as the write, so a redelivery is recognised and
 * acked rather than applied twice, and an order no longer `pending` (already
 * paid, or compensated away) is left exactly as it is.
 */
export const startPaymentStatusProjection = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const store = yield* ProductOrderStoreTag;
  const consumer = queueNameFor(capturedSubscription);

  yield* bus.subscribe(capturedSubscription, event =>
    Effect.flatMap(readPaymentOutcome(event.data), outcome =>
      Effect.asVoid(
        store.markPaid(
          { consumer, eventId: event.id },
          outcome.orderId,
          outcome.decidedAt,
        ),
      ),
    ),
  );
});
