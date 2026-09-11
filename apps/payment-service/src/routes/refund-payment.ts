import { randomUUID } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { PaymentOutcome } from '@r10c/business-ts-payment-contracts';
import {
  type PaymentMethod,
  PaymentProviderTag,
  Refund,
} from '@r10c/business-ts-payment-management';
import {
  EntifixConnError,
  envelopeEntityName,
  makeEntityEnvelope,
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
import {
  PAYMENT_COLLECTION,
  REFUND_COLLECTION,
  refundDecidedEntry,
} from '../outbox';
import { serverError } from './capture-payment';

/** Thrown inside the transaction when this command was already applied. */
class AlreadyDecided extends Error {}

/** Thrown inside the transaction when this capture already has a refund. */
class AlreadyRefunded extends Error {}

/** The capture, as much of it as this route reads. */
interface CapturedPayment {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: PaymentMethod;
  readonly providerReference?: string;
}

const badRequest = (detail: string) =>
  HttpServerResponse.json(
    { error: 'invalid request body', code: 'invalidBody', detail },
    { status: 400 },
  );

/**
 * What a caller sends: an order, and nothing else.
 *
 * ⚠️ **Not an entity envelope, because the caller authors no member of a
 * `Refund`.** Every one of them is server-owned — the id, the payment it
 * reverses, the amount, the currency, the status, the provider's reference and
 * the moment it was decided — so parsing a `Refund` off the wire would invite a
 * body that names its own amount. This is a verb with an argument, the shape
 * `POST /api/counter-sale` already uses.
 */
const readOrderId = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const { orderId } = body as Record<string, unknown>;
  return typeof orderId === 'string' && orderId !== '' ? orderId : undefined;
};

const refundEnvelope = (document: unknown) =>
  makeEntityEnvelope(Refund, document as never, []);

/**
 * Send the money back for an order, record it, and announce it — in one Mongo
 * transaction.
 *
 * ⚠️ **Addressed by the order, not by the payment.** The cancellation saga holds
 * an order id and has never seen a payment id; `Payment.orderId` is filterable
 * and indexed, so the route resolves the capture itself. That also means a
 * caller cannot aim a refund at a payment belonging to somebody else's order.
 *
 * ⚠️ **The amount is copied off the resolved capture and never read from the
 * request.** A body that can name its own amount is a body that can refund more
 * than was ever charged, and no caller has a reason to say.
 *
 * ⚠️ **Two guards against refunding twice, and they answer different
 * questions.** `x-command-id` claimed in the transaction covers a *redelivery*
 * of one command; the unique index on `paymentId` covers two *different*
 * commands aimed at one capture. The pre-read before the provider call is what
 * keeps the second case from moving money at the provider before the index
 * refuses to record it
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * ⚠️ **A refusal answers `402` and still writes the row.** The record that an
 * attempt happened is what a vendor's support and a reconciliation both need,
 * and the non-2xx is what tells the coordinator the pivot did not commit. What
 * it does **not** write is a bus message — see {@link refundDecidedEntry}.
 */
export const refundPaymentRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const provider = yield* PaymentProviderTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const orderId = readOrderId(yield* request.json);

  if (orderId === undefined) {
    return yield* badRequest('a refund must name the order it is for');
  }

  const capture = yield* Effect.tryPromise({
    try: () =>
      db
        .collection(PAYMENT_COLLECTION)
        .findOne({ orderId, status: 'captured' }, { projection: { _id: 0 } }),
    catch: error =>
      new EntifixConnError('Failed to read the captured payment', error, {
        orderId,
      }),
  });

  if (capture === null) {
    // A business refusal rather than a fault: an order nobody paid for has
    // nothing to send back, and the coordinator reads a 4xx as "this step
    // refused" and compensates the claim before it.
    return yield* HttpServerResponse.json(
      {
        error: 'no captured payment for this order',
        code: 'noCapturedPayment',
        detail: 'nothing was captured for this order, so nothing can go back',
        orderId,
      },
      { status: 404 },
    );
  }

  const captured = capture as unknown as CapturedPayment;

  // Read before calling the provider, not only after. The unique index below is
  // the backstop for a race; this is what stops a second command moving money
  // at the provider and then being refused a row to record it in.
  const existingForPayment = yield* Effect.tryPromise({
    try: () =>
      db
        .collection(REFUND_COLLECTION)
        .findOne({ paymentId: captured.id }, { projection: { _id: 0 } }),
    catch: error =>
      new EntifixConnError('Failed to read an existing refund', error, {
        paymentId: captured.id,
      }),
  });

  if (existingForPayment !== null) {
    const decided = (existingForPayment as { status?: unknown }).status;
    return yield* HttpServerResponse.json(refundEnvelope(existingForPayment), {
      status: decided === 'refunded' ? 200 : 402,
    });
  }

  const refund = new Refund(
    orderId,
    captured.id,
    captured.amount,
    captured.currency,
  );
  refund.id = randomUUID();
  refund.status = 'pending';

  const outcome = yield* provider.refund({
    // Our id for *this* attempt, which a real adapter sends as the provider's
    // idempotency key. Deliberately not the capture's: reusing that would make
    // the refund and the charge one idempotent operation at the far end.
    paymentId: String(refund.id),
    orderId,
    amount: captured.amount,
    currency: captured.currency,
    paymentMethod: captured.paymentMethod,
    // The capture's reference is what a real provider refunds *against*.
    providerReference: captured.providerReference,
  });

  const refunded = outcome.status === 'refunded';
  const decidedAt = new Date();

  refund.status = refunded ? 'refunded' : 'failed';
  refund.providerReference = outcome.providerReference;
  refund.decidedAt = decidedAt;

  const announcement: PaymentOutcome = {
    // The capture being reversed — what a reconciliation pairs, and what the
    // deduplication key is built from.
    paymentId: captured.id,
    orderId,
    amount: captured.amount,
    currency: captured.currency,
    paymentMethod: captured.paymentMethod,
    decidedAt: decidedAt.toISOString(),
    providerReference: outcome.providerReference,
    failureReason: outcome.failureReason,
    refundId: String(refund.id),
  };

  const document = serializeEntity(Refund, refund);
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
          try {
            await db
              .collection(REFUND_COLLECTION)
              .insertOne(
                { ...document, id: refund.id, commandId },
                { session },
              );
          } catch (error) {
            if ((error as { code?: unknown }).code === 11_000) {
              throw new AlreadyRefunded();
            }
            throw error;
          }
          await refundDecidedEntry(db, session, announcement, refunded);
        });
        return 'written' as const;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      error instanceof AlreadyDecided || error instanceof AlreadyRefunded
        ? error
        : new EntifixConnError('Failed to write the refund', error, {
            refundId: String(refund.id),
          }),
  }).pipe(
    // One `catchIf` over both sentinels rather than two chained ones: the first
    // narrows the error channel to `never`, so a second could never see the
    // type it is written to match.
    Effect.catchIf(
      (error): error is AlreadyDecided | AlreadyRefunded =>
        error instanceof AlreadyDecided || error instanceof AlreadyRefunded,
      error =>
        Effect.succeed(
          error instanceof AlreadyDecided
            ? ('replayed' as const)
            : ('raced' as const),
        ),
    ),
  );

  if (written !== 'written') {
    // ⚠️ The replay answers what the **first** attempt decided, status and all.
    // A redelivered command that had been refused must stay refused: telling the
    // coordinator otherwise would roll a flow forward past money that never
    // moved. `raced` reads the sibling command's row for the same reason.
    const filter =
      written === 'replayed' ? { commandId } : { paymentId: captured.id };

    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .collection(REFUND_COLLECTION)
          .findOne(filter, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the claimed refund', error, {
          commandId,
          paymentId: captured.id,
        }),
    });

    const replayed = (existing as { status?: unknown } | null)?.status;
    return yield* HttpServerResponse.json(refundEnvelope(existing), {
      status: replayed === 'refunded' ? 200 : 402,
    });
  }

  if (!refunded) {
    return yield* HttpServerResponse.json(
      {
        error: 'the refund was not made',
        code: 'refundDeclined',
        detail: outcome.failureReason ?? 'the provider declined the refund',
        refundId: String(refund.id),
      },
      { status: 402 },
    );
  }

  const key = envelopeEntityName(Refund);

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(Refund, refund, [
      { rel: 'self', href: `/api/${key}/${String(refund.id)}`, method: 'GET' },
      { rel: 'list', href: `/api/${key}`, method: 'GET' },
    ]),
    { status: 201 },
  );
}).pipe(Effect.catchAll(serverError));
