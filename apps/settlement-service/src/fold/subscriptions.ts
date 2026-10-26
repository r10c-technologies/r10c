import { queueNameFor } from '@entifix/amqp/transactions';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import {
  PAYMENT_CAPTURED,
  PAYMENT_REFUNDED,
} from '@r10c/business-ts-payment-contracts';
import {
  foldCancellation,
  foldCapture,
  foldPlacedOrder,
  foldRefund,
  SaleJoinTag,
} from '@r10c/business-ts-settlement-management';
import { Effect } from 'effect';

/** Redeliveries before a message this slice cannot fold is quarantined. */
const MAX_ATTEMPTS = 5;

const subscription = (pattern: string): Subscription => ({
  slice: 'settlement',
  pattern,
  // `work`: each message must fold exactly once whichever replica receives it.
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
});

/**
 * The four messages the commission ledger folds, in two pairs: the sale
 * (`order.placed` + `payment.captured`) and its reversal (`order.cancelled`
 * + `payment.refunded`). No member of either pair is sufficient alone, which
 * is why the folds join on the order id rather than writing per message
 * (ADR 0057, 0058 §9). `payment.failed` is not consumed: a capture that
 * refused compensates the flow and deletes the order — nothing to settle.
 */
export const startSettlementFold = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  // Resolved once, at boot: a handler runs with nothing left to provide.
  const join = yield* SaleJoinTag;
  for (const [pattern, fold] of [
    ['order.placed', foldPlacedOrder],
    [PAYMENT_CAPTURED, foldCapture],
    ['order.cancelled', foldCancellation],
    [PAYMENT_REFUNDED, foldRefund],
  ] as const) {
    const consumes = subscription(pattern);
    const consumer = queueNameFor(consumes);
    yield* bus.subscribe(consumes, event =>
      Effect.asVoid(fold(consumer, event)).pipe(
        Effect.provideService(SaleJoinTag, join),
        Effect.withSpan(`settlement.${pattern}`),
      ),
    );
  }
});
