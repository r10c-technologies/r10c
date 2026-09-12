import {
  PAYMENT_CAPTURED,
  PAYMENT_REFUNDED,
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
import { readCancelledOrder, readPlacedOrder } from './placed-order';

/** The routing key order-service publishes a new order under. */
const ORDER_PLACED = 'order.placed';

/**
 * And the one it publishes a cancelled order under.
 *
 * A literal here rather than an import, as `ORDER_PLACED` is: order-management
 * has no contracts package, and ADR 0057 §3 records why a hand-written reader is
 * the right answer for this producer rather than a copied shape.
 */
const ORDER_CANCELLED = 'order.cancelled';

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
 * The four queues this slice binds — two per fold.
 *
 * `queueNameFor` is `<slice>.<pattern>`, so these are `settlement.order.placed`,
 * `settlement.payment.captured`, `settlement.order.cancelled` and
 * `settlement.payment.refunded` — distinct names, independent delivery budgets,
 * and independent quarantines. One poison order cannot stall the captures behind
 * it, and a stuck cancellation cannot stall the sales.
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

export const cancelledSubscription: Subscription = {
  slice: SETTLEMENT_SLICE,
  pattern: ORDER_CANCELLED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

export const refundedSubscription: Subscription = {
  slice: SETTLEMENT_SLICE,
  pattern: PAYMENT_REFUNDED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

const logOutcome = (
  event: string,
  orderId: string,
  outcome: FoldOutcome,
): Effect.Effect<void> => {
  if (outcome.kind === 'written') {
    // Two lines rather than one, because a single pass can do both and a reader
    // scanning for claw-backs should not have to parse a count out of a message
    // about sales. `folded: 0` is ordinary on a reversal and vice versa.
    const annotations = { event, orderId };
    const sale =
      outcome.folded > 0
        ? Effect.logInfo('folded a sale into commission entries').pipe(
            Effect.annotateLogs({ ...annotations, entries: outcome.folded }),
          )
        : Effect.void;
    const reversal =
      outcome.reversed > 0
        ? Effect.logInfo('reversed the commission entries for a sale').pipe(
            Effect.annotateLogs({ ...annotations, entries: outcome.reversed }),
          )
        : Effect.void;
    return Effect.zipRight(sale, reversal);
  }
  if (outcome.kind === 'duplicate') {
    return Effect.logDebug('skipped a redelivered settlement message').pipe(
      Effect.annotateLogs({ event, orderId }),
    );
  }
  // The common case on the first half of either pair to arrive, and not worth an
  // info line per sale: every order produces at least one of these before a pair
  // completes.
  return Effect.logDebug('holding a sale until its other half arrives').pipe(
    Effect.annotateLogs({ event, orderId }),
  );
};

/**
 * The distinct vendors on an order, in the order their first line appears.
 *
 * ⚠️ **Deliberately not `[...new Set(ids)]`, which is broken in this bundle.**
 * The `Set` itself is correct — its `size` is right — but spreading it here
 * yields an array of the iterator's internal objects rather than the strings,
 * so the agreement query became `{ vendorId: { $in: [{}] } }`, matched nothing,
 * and every vendor on every sale was reported as having no agreement on file.
 * The commission ledger then stayed empty while the service logged a plausible
 * business reason for it, which is why this survived a green build and a green
 * test suite.
 *
 * `indexOf` over a short array needs no iterator protocol at all, so no
 * downlevelling choice can change what it means. Orders carry a handful of
 * lines, so the quadratic scan is not worth a `Set` even if one worked.
 */
const uniqueVendors = (
  lines: readonly { readonly vendorId: string }[],
): string[] =>
  lines
    .map(line => line.vendorId)
    .filter((vendorId, index, all) => all.indexOf(vendorId) === index);

/**
 * ⚠️ **Every handler below is an arrow returning `Effect.gen(...).pipe(
 * Effect.withSpan(name))`, and specifically *not* `Effect.fn(name)(function*)`.**
 *
 * The two that existed before this file grew its second pair were written with
 * `Effect.fn`, they were the only two uses of it in the repo, and both were
 * broken: the value it hands back is not an effect this runtime can execute, so
 * the fiber the bus adapter starts dies on the **first delivered message** with
 * `RuntimeException: Not a valid effect: {}` and takes the process with it.
 *
 * Nothing caught it. It compiles, the mock e2e profile boots no bus at all so no
 * handler runs there, and a service that dies on its first message still passes
 * every readiness probe until one arrives — so the fleet looked healthy with the
 * commission ledger silently empty and the queues quietly filling.
 *
 * `withSpan` keeps the traced name that was the reason for `Effect.fn` in the
 * first place, and it is the form the rest of the fleet's consumers already use.
 */

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
  ((event: {
    id: string;
    data: unknown;
  }) => Effect.gen(function* () {
    const order = yield* readPlacedOrder(event.data);
    const vendorIds = uniqueVendors(order.lines);
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
  }).pipe(Effect.withSpan('settlement.order.placed')));

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
  ((event: {
    id: string;
    data: unknown;
  }) => Effect.gen(function* () {
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
  }).pipe(Effect.withSpan('settlement.payment.captured')));

/**
 * The cancellation's half: the fact, and the reversal if the refund already
 * landed.
 *
 * ⚠️ **It contributes no amounts, and reads none.** The reversing rows mirror
 * what is already in the ledger, so this handler needs nothing off the payload
 * but the order id. Re-pricing the cancelled order's lines was the obvious
 * alternative and is wrong: it reads whatever the vendor's agreement says *now*,
 * so terms re-negotiated between the sale and the cancel would leave a pair that
 * does not cancel — the rate drift ADR 0022 §8 captures commission per sale to
 * close.
 *
 * ⚠️ **The whole payload is still decoded.** Nothing here needs the lines, but a
 * message that cannot be read is one no retry will fix, and rejecting it
 * classifies it poison and quarantines it loudly rather than acking a shape
 * nobody has looked at.
 */
const handleCancelled = (client: MongoClient, db: Db, consumer: string) =>
  ((event: {
    id: string;
    at: string;
    data: unknown;
  }) => Effect.gen(function* () {
    const order = yield* readCancelledOrder(event.data);
    // The envelope's own `at`, which order-service stamps in the same
    // transaction as the `cancelled` status. It is recorded for the audit trail
    // and never used as an `occurredAt`: a claw-back is filed under when the
    // *money* went back, which is the refund's `decidedAt`, not this.
    const outcome = yield* contributeToSale(
      client,
      db,
      consumer,
      event.id,
      order.orderId,
      { cancelledAt: event.at },
    );
    yield* logOutcome(ORDER_CANCELLED, order.orderId, outcome);
  }).pipe(Effect.withSpan('settlement.order.cancelled')));

/**
 * The refund's half: a timestamp, and the reversal if the cancellation already
 * landed.
 *
 * ⚠️ **`payment.refunded` is a different fact from `payment.failed`, and the
 * distinction is why one is consumed here and the other is not.** A refusal is a
 * capture that never happened — nothing to settle and nothing to un-settle. A
 * refund is money that moved and has now moved back, over a sale this ledger has
 * already priced.
 *
 * ⚠️ **The reversing rows' `occurredAt` is this message's `decidedAt`**, for the
 * reason the sale's is the capture's: it is what a run compares against its
 * period, and the sale's own timestamp would file a claw-back into a period that
 * may already be settled.
 */
const handleRefunded = (client: MongoClient, db: Db, consumer: string) =>
  ((event: {
    id: string;
    data: unknown;
  }) => Effect.gen(function* () {
    const outcome = yield* readPaymentOutcome(event.data);
    const written = yield* contributeToSale(
      client,
      db,
      consumer,
      event.id,
      outcome.orderId,
      { refundedAt: outcome.decidedAt },
    );
    yield* logOutcome(PAYMENT_REFUNDED, outcome.orderId, written);
  }).pipe(Effect.withSpan('settlement.payment.refunded')));

/**
 * Start consuming all four halves: a sale's two, and its reversal's two.
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

  yield* bus.subscribe(
    cancelledSubscription,
    handleCancelled(client, db, queueNameFor(cancelledSubscription)),
  );

  yield* bus.subscribe(
    refundedSubscription,
    handleRefunded(client, db, queueNameFor(refundedSubscription)),
  );
});
