import { randomUUID } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import {
  Payment,
  PaymentProviderTag,
} from '@r10c/business-ts-payment-management';
import {
  EntifixBuildError,
  EntifixConnError,
  envelopeEntityName,
  makeEntityEnvelope,
  readEntityEnvelope,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';

import {
  claimCommand,
  COMMAND_ID_HEADER,
  ensureCommandInboxIndexes,
} from '../command-inbox';
import { PAYMENT_COLLECTION, paymentDecidedEntry } from '../outbox';

/** Thrown inside the transaction when this command was already applied. */
class AlreadyDecided extends Error {}

export const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * Take money for an order, record how it went, and announce it — in one Mongo
 * transaction.
 *
 * ⚠️ **This route is the checkout saga's pivot**, and everything below follows
 * from that. Once it answers `201` the flow cannot be unwound: `runSaga` stops
 * compensating and rolls forward, because the alternative is deleting an order
 * the buyer has been charged for
 * ([ADR 0054](../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 *
 * ⚠️ **`x-command-id` is claimed in the same transaction as the write.** A
 * capture is the one operation in this fleet that cannot be naturally
 * idempotent — ADR 0030 names it — and the engine re-dispatches a post-pivot
 * step on a stable command id. The claim is what makes that safe.
 *
 * ⚠️ **A refusal answers `402`, and still writes.** The `Payment` row and the
 * `payment.failed` entry are the record that an attempt happened, which
 * reconciliation and a vendor's support both need; the non-2xx is what tells the
 * coordinator the pivot did not commit, so the flow compensates. Answering `200`
 * with a failed body would let the saga roll forward past a payment nobody made.
 *
 * ⚠️ **Server-owned: the id, the status, `providerReference` and `decidedAt`.**
 * A body arriving as `captured` would claim money nobody took. The caller
 * supplies the order, the amount, the currency, the method and the channel, and
 * nothing else survives.
 */
export const capturePaymentRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const provider = yield* PaymentProviderTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const payment = yield* readEntityEnvelope(Payment, body);

  if (payment.amount <= 0) {
    // A payment for nothing is not a payment. It would settle to nothing and
    // convert a reservation for free, so it is refused where it is cheapest.
    return yield* HttpServerResponse.json(
      {
        error: 'invalid request body',
        code: 'invalidBody',
        detail: 'a payment must carry a positive amount',
      },
      { status: 400 },
    );
  }

  payment.id = randomUUID();
  payment.status = 'pending';

  const outcome = yield* provider.capture({
    paymentId: String(payment.id),
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod,
  });

  payment.status = outcome.status;
  payment.providerReference = outcome.providerReference;

  const decidedAt = new Date().toISOString();
  const captured = outcome.status === 'captured';

  const announcement: PaymentOutcome = {
    paymentId: String(payment.id),
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod,
    decidedAt,
    channelId: payment.channelId,
    providerReference: outcome.providerReference,
    failureReason: outcome.failureReason,
  };

  const document = serializeEntity(Payment, payment);
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  if (commandId) {
    yield* ensureCommandInboxIndexes(db);
  }

  const written = yield* Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          if (commandId && !(await claimCommand(db, session, commandId))) {
            throw new AlreadyDecided();
          }
          await db
            .collection(PAYMENT_COLLECTION)
            .insertOne(
              { ...document, id: payment.id, decidedAt, commandId },
              { session },
            );
          await paymentDecidedEntry(db, session, announcement, captured);
        });
        return true;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      error instanceof AlreadyDecided
        ? error
        : new EntifixConnError('Failed to write the payment', error, {
            paymentId: String(payment.id),
          }),
  }).pipe(
    Effect.catchIf(
      (error): error is AlreadyDecided => error instanceof AlreadyDecided,
      () => Effect.succeed(false),
    ),
  );

  const key = envelopeEntityName(Payment);

  if (!written) {
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .collection(PAYMENT_COLLECTION)
          .findOne({ commandId }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the claimed payment', error, {
          commandId,
        }),
    });

    // ⚠️ The replay answers what the **first** attempt decided, status and all.
    // A redelivered command that had been declined must stay declined: telling
    // the coordinator otherwise would roll a saga forward past a payment that
    // never happened. So the status is read back rather than recomputed, and a
    // declined replay answers `402` exactly as the original did.
    const replayed = (existing as { status?: unknown } | null)?.status;
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(Payment, existing as never, []),
      { status: replayed === 'captured' ? 200 : 402 },
    );
  }

  if (!captured) {
    return yield* HttpServerResponse.json(
      {
        error: 'the payment was not captured',
        code: 'paymentDeclined',
        detail: outcome.failureReason ?? 'the provider declined the payment',
        paymentId: String(payment.id),
      },
      { status: 402 },
    );
  }

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(Payment, payment, [
      { rel: 'self', href: `/api/${key}/${String(payment.id)}`, method: 'GET' },
      { rel: 'list', href: `/api/${key}`, method: 'GET' },
    ]),
    { status: 201 },
  );
}).pipe(
  Effect.catchAll(error =>
    error instanceof EntifixBuildError
      ? HttpServerResponse.json(
          {
            error: 'invalid request body',
            code: 'invalidBody',
            detail: error.message,
          },
          { status: 400 },
        )
      : serverError(error),
  ),
);
