import {
  PAYMENT_CAPTURED,
  readPaymentOutcome,
} from '@r10c/business-ts-payment-contracts';
import { EventBusTag, type Subscription } from '@r10c/entifix-transactions';
import { queueNameFor } from '@r10c/entifix-ts-amqp-client';
import {
  ensureInboxIndexes,
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { SETTLEMENT_SLICE } from '../outbox';
import { commissionsForOrder } from './commission';
import {
  agreementsFor,
  contributeToSale,
  ensurePendingSaleIndexes,
  type FoldOutcome,
} from './pending-sale';
import { readPlacedOrder } from './placed-order';

/** The routing key order-service publishes a new order under. */
const ORDER_PLACED = 'order.placed';

/**
 * ⚠️ **A literal beside the declaration, deliberately not configuration.** It
 * becomes each queue's `x-delivery-limit`, which RabbitMQ fixes when the queue
 * is declared and will not change on an existing one. A config row would read
 * like a tunable and silently do nothing; changing this means deleting the
 * queue, which locally is `pnpm run <app>:dev:reset`.
 *
 * It must match both subscriptions' `maxAttempts` in `tools/slices/`, and
 * `slices.spec.ts` is what keeps the two honest.
 */
const MAX_ATTEMPTS = 5;

/**
 * The two queues this slice binds.
 *
 * `queueNameFor` is `<slice>.<pattern>`, so these are `settlement.order.placed`
 * and `settlement.payment.captured` — distinct names, independent delivery
 * budgets, and independent quarantines. One poison order cannot stall the
 * captures behind it.
 */
export const placedSubscription: Subscription = {
  slice: SETTLEMENT_SLICE,
  pattern: ORDER_PLACED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

export const capturedSubscription: Subscription = {
  slice: SETTLEMENT_SLICE,
  pattern: PAYMENT_CAPTURED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

const logOutcome = (
  event: string,
  orderId: string,
  outcome: FoldOutcome,
): Effect.Effect<void> => {
  if (outcome.kind === 'folded') {
    return Effect.logInfo('folded a sale into commission entries').pipe(
      Effect.annotateLogs({ event, orderId, entries: outcome.entries }),
    );
  }
  if (outcome.kind === 'duplicate') {
    return Effect.logDebug('skipped a redelivered settlement message').pipe(
      Effect.annotateLogs({ event, orderId }),
    );
  }
  // The common case on the first half to arrive, and not worth an info line per
  // sale: every order produces exactly one of these before its pair completes.
  return Effect.logDebug('holding a sale until its other half arrives').pipe(
    Effect.annotateLogs({ event, orderId }),
  );
};

/**
 * The order's half: price the lines, and fold if the payment already landed.
 *
 * ⚠️ **A vendor with no agreement is logged at error and the rest of the order
 * still settles.** Refusing the whole message would quarantine a sale that is
 * mostly priceable, and the alternative — a guessed rate — is the one thing this
 * domain must never do. The line is loud because it means a real vendor is
 * selling with no commercial terms on file, which somebody has to fix.
 */
const handlePlaced = (client: MongoClient, db: Db, consumer: string) =>
  Effect.fn('settlement.order.placed')(function* (event: {
    id: string;
    data: unknown;
  }) {
    const order = yield* readPlacedOrder(event.data);
    const vendorIds = [...new Set(order.lines.map(line => line.vendorId))];
    const agreements = yield* agreementsFor(db, vendorIds);
    const { commissions, unpriced } = commissionsForOrder({
      lines: order.lines,
      channelType: order.channelType,
      agreements,
    });

    if (unpriced.length > 0) {
      yield* Effect.logError(
        'sold for a vendor with no agreement on file',
      ).pipe(
        Effect.annotateLogs({ orderId: order.orderId, vendors: unpriced }),
      );
    }

    const outcome = yield* contributeToSale(
      client,
      db,
      consumer,
      event.id,
      order.orderId,
      { commissions, unpriced },
    );
    yield* logOutcome(ORDER_PLACED, order.orderId, outcome);
  });

/**
 * The payment's half: a timestamp, and the fold if the order already landed.
 *
 * ⚠️ **`payment.failed` is not consumed here, and the omission is deliberate.**
 * A refused capture is the checkout saga's pivot refusing, which compensates the
 * flow and deletes the order — so there is nothing to settle and nothing to
 * un-settle. A handler reacting to it would be reasoning about a sale that never
 * happened (ADR 0054).
 *
 * ⚠️ **The entries' `occurredAt` is this message's `decidedAt`, never `now`.**
 * It is what a settlement run compares against its period, so stamping the
 * handling time would file a sale under whichever period the consumer happened
 * to be running in — and a redelivery or a replay would file it differently each
 * time.
 */
const handleCaptured = (client: MongoClient, db: Db, consumer: string) =>
  Effect.fn('settlement.payment.captured')(function* (event: {
    id: string;
    data: unknown;
  }) {
    const outcome = yield* readPaymentOutcome(event.data);
    const folded = yield* contributeToSale(
      client,
      db,
      consumer,
      event.id,
      outcome.orderId,
      { decidedAt: outcome.decidedAt },
    );
    yield* logOutcome(PAYMENT_CAPTURED, outcome.orderId, folded);
  });

/**
 * Start consuming both halves of a sale.
 *
 * ⚠️ **`ensureInboxIndexes` runs before the first claim, not eventually.** The
 * unique index *is* the claim; without it two concurrent first deliveries both
 * insert and both fold. It is compound on `(consumer, eventId)`, which is what
 * lets these two consumers share one database without either starving the other
 * of messages the other has already claimed.
 *
 * ⚠️ **Each payload is decoded rather than cast.** A rejected payload fails with
 * `EntifixBuildError`, which the bus classifies as **poison** and quarantines
 * with zero retries — the right answer for a message that can never parse. A
 * cast would turn the same message into a handler failure, requeued five times,
 * spending the delivery budget of every message behind it (ADR 0030).
 */
export const startSettlementFold = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const bus = yield* EventBusTag;

  yield* ensureInboxIndexes(db);
  yield* ensurePendingSaleIndexes(db);

  // The consumer half of the claim key: the durable work-queue name each
  // subscription binds. Derived rather than written out, so it cannot drift
  // from the queue the broker actually delivers on.
  yield* bus.subscribe(
    placedSubscription,
    handlePlaced(client, db, queueNameFor(placedSubscription)),
  );

  yield* bus.subscribe(
    capturedSubscription,
    handleCaptured(client, db, queueNameFor(capturedSubscription)),
  );
});
