import {
  PAYMENT_CAPTURED,
  type PaymentOutcome,
  readPaymentOutcome,
} from '@r10c/business-ts-payment-contracts';
import {
  EventBusTag,
  type InboxClaim,
  type Subscription,
} from '@r10c/entifix-transactions';
import { queueNameFor } from '@r10c/entifix-ts-amqp-client';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import {
  ensureInboxIndexes,
  INBOX_COLLECTION,
  inboxDocument,
  isDuplicateKey,
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { ORDER_COLLECTION, ORDER_SLICE } from '../outbox';

/**
 * ⚠️ **A literal beside the declaration, deliberately not configuration.** It
 * becomes the queue's `x-delivery-limit`, which RabbitMQ fixes when the queue is
 * declared and will not change on an existing one. A config row would read like
 * a tunable and silently do nothing; changing this means deleting the queue,
 * which locally is `pnpm run <app>:dev:reset`.
 *
 * It must match `payment.captured`'s `maxAttempts` in `tools/slices/`, and
 * `slices.spec.ts` is what keeps the two honest.
 */
const MAX_ATTEMPTS = 5;

/**
 * The order's own view of a payment: `pending` becomes `paid`.
 *
 * ⚠️ **This is deliberately the *only* thing this consumer does**, and the
 * division is the point of ADR 0054. The checkout saga captures synchronously,
 * because a buyer is waiting and a hold on a vendor's stock expires in minutes;
 * it also converts the reservation, because that is a crossing only the
 * coordinator holds a token for. What is left is the part that can safely be
 * late — the status a buyer reads on their receipt — and that rides the bus.
 *
 * ⚠️ **`payment.failed` is not consumed here.** A refused capture is the saga's
 * pivot refusing, which compensates the flow and *deletes* the order. A handler
 * writing `cancelled` onto that same order would be racing its own deletion.
 */
const advanceToPaid = (
  client: MongoClient,
  db: Db,
  consumer: string,
  eventId: string,
  outcome: PaymentOutcome,
) =>
  Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await db
            .collection<InboxClaim>(INBOX_COLLECTION)
            .insertOne(inboxDocument(consumer, eventId), { session });

          // ⚠️ **`status: 'pending'` is in the filter, not just the update.**
          // It is the ordering guard: an order that has already been fulfilled
          // or cancelled must not be walked backwards to `paid` by a
          // redelivered capture arriving out of order behind a later
          // transition. The claim above stops the *same* message twice; this
          // stops a stale one.
          await db
            .collection(ORDER_COLLECTION)
            .updateOne(
              { id: outcome.orderId, status: 'pending' },
              { $set: { status: 'paid', paidAt: outcome.decidedAt } },
              { session },
            );
        });
        return 'claimed' as const;
      } finally {
        await session.endSession();
      }
    },
    catch: error => {
      // Not a failure: the unique index rejected a second claim for this
      // consumer and message, which is how a redelivery is identified. The
      // transaction aborted with it, so the update did not run twice either.
      if (isDuplicateKey(error)) return 'duplicate' as const;
      return new EntifixConnError('Failed to advance the order', error, {
        consumer,
        eventId,
        orderId: outcome.orderId,
      });
    },
  }).pipe(
    // The duplicate arm above leaves the "error" channel carrying a literal, so
    // lift it back: a redelivery must ack, never nack. Nacking would requeue it
    // against `x-delivery-limit` and eventually quarantine a message that was
    // in fact processed.
    Effect.catchAll(outcome =>
      outcome === 'duplicate'
        ? Effect.succeed('duplicate' as const)
        : Effect.fail(outcome),
    ),
  );

/** The subscription this service binds. One event, one queue, one order. */
export const capturedSubscription: Subscription = {
  slice: ORDER_SLICE,
  pattern: PAYMENT_CAPTURED,
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

/**
 * Start consuming `payment.captured`.
 *
 * ⚠️ **`ensureInboxIndexes` runs before the first claim, not eventually.** The
 * unique index is the claim; without it two concurrent first deliveries both
 * insert and both advance the order.
 *
 * ⚠️ **The payload is decoded through `readPaymentOutcome` rather than cast.**
 * A rejected payload fails with `EntifixBuildError`, which the bus classifies as
 * **poison** and quarantines with zero retries — the right answer for a message
 * that can never parse. A cast would turn the same message into a handler
 * failure, requeued five times, spending the delivery budget of every message
 * behind it (ADR 0030).
 */
export const startPaymentStatusProjection = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const bus = yield* EventBusTag;

  yield* ensureInboxIndexes(db);

  // The consumer half of the claim key: the durable work-queue name this
  // subscription binds. Derived rather than written out, so it cannot drift
  // from the queue the broker actually delivers on.
  const consumer = queueNameFor(capturedSubscription);

  yield* bus.subscribe(capturedSubscription, event =>
    Effect.flatMap(readPaymentOutcome(event.data), outcome =>
      Effect.asVoid(advanceToPaid(client, db, consumer, event.id, outcome)),
    ),
  );
});
