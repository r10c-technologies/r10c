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
  type FoldReport,
  SaleJoinTag,
} from '@r10c/business-ts-settlement-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
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
/**
 * What a fold did, logged at the consumer — the one fork site the fold runs
 * under (ADR 0064). A vendor sold for with no agreement is an error: a sale
 * nobody can price until someone writes the terms.
 */
export const logFoldReport = (report: FoldReport): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { event, orderId, outcome, unpriced } = report;
    if (unpriced.length > 0) {
      yield* logSliceOutcome(
        'Error',
        'sold for a vendor with no agreement on file',
        { event, orderId, vendors: unpriced },
      );
    }
    if (outcome.kind === 'duplicate') {
      yield* logSliceOutcome('Debug', 'settlement fold', {
        outcome: 'alreadyApplied',
        event,
        orderId,
      });
      return;
    }
    if (outcome.kind === 'waiting') {
      yield* logSliceOutcome('Debug', 'settlement fold', {
        outcome: 'awaitingPair',
        event,
        orderId,
      });
      return;
    }
    if (outcome.folded > 0) {
      yield* logSliceOutcome('Info', 'settlement fold', {
        outcome: 'folded',
        event,
        orderId,
        entries: outcome.folded,
      });
    }
    if (outcome.reversed > 0) {
      yield* logSliceOutcome('Info', 'settlement fold', {
        outcome: 'reversed',
        event,
        orderId,
        entries: outcome.reversed,
      });
    }
  });

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
      fold(consumer, event).pipe(
        Effect.flatMap(logFoldReport),
        Effect.provideService(SaleJoinTag, join),
        Effect.withSpan(`settlement.${pattern}`),
      ),
    );
  }
});
