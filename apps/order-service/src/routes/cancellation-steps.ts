import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { ProductOrder } from '@r10c/business-ts-order-management';
import {
  EntifixConnError,
  envelopeEntityName,
  makeEntityEnvelope,
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
import { ORDER_COLLECTION, orderCancelledEntry } from '../outbox';
import { serverError } from './entity-crud';

/**
 * The three writes the cancellation saga dispatches into this service.
 *
 * ⚠️ **All three take a crossing token and no session**, which is the same rule
 * the checkout writes next door follow: the buyer behind a cancellation holds no
 * grant over the refund made on their behalf, and the vendor's own session was
 * already checked at the entry route that started the flow. One route, one
 * credential ([ADR 0023](../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * ⚠️ **They reuse `order-management:product-order:write` rather than adding
 * crossing permissions of their own.** That permission already names "writing
 * the order the holds were taken for", and every one of these is a write to that
 * same record by the same coordinator. A `product-order:cancel` entry in
 * `SERVICE_CROSSING_PERMISSIONS` would be a second name for one authority, and
 * the session verb of the same name is a *different* act — asking for a
 * cancellation rather than performing one.
 */

/** Thrown inside the claim's transaction when another flow already holds it. */
class NotClaimable extends Error {}

/** An order document, as much of it as these routes read. */
interface StoredOrder {
  readonly id: string;
  readonly status: string;
}

const notFound = (orderId: string) =>
  HttpServerResponse.json(
    {
      error: 'not found',
      code: 'notFound',
      entity: envelopeEntityName(ProductOrder),
      orderId,
    },
    { status: 404 },
  );

const envelopeFor = (document: unknown, orderId: string) => {
  const key = envelopeEntityName(ProductOrder);
  return makeEntityEnvelope(ProductOrder, document as never, [
    { rel: 'self', href: `/api/${key}/${orderId}`, method: 'GET' },
    { rel: 'list', href: `/api/${key}`, method: 'GET' },
  ]);
};

/**
 * Step 1 — claim a paid order for cancellation.
 *
 * ⚠️ **This is the concurrency guard, not a formality.** The conditional write
 * `paid → cancelling` is what stops two cancellations running at once: the
 * second one matches no document and the coordinator compensates it, so exactly
 * one refund is ever dispatched
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §3).
 *
 * ⚠️ **Two guards, and the second one was learned the hard way.** The status
 * alone cannot tell a *redelivery of this command* from a *rival flow*: both
 * arrive at an order that is already `cancelling`. Answering them alike — `200`,
 * because a redelivery must not be refused — lets every rival walk on past the
 * claim, and the steps after it are idempotent only on their own command id.
 * Measured on the live lab: six simultaneous cancels produced **one refund and
 * six stock restorations**, handing a vendor five units back that were never
 * sold. So the command inbox answers "is this the same command?" and the status
 * answers "is this order still claimable?", and neither is redundant.
 *
 * ⚠️ **It answers the whole order, and the compensation depends on that.** A
 * compensation's path template resolves against its own call's response body and
 * nothing else — no inputs, no earlier steps — so an answer that did not carry
 * the id would leave the release below with no record to address.
 *
 * A `409` rather than a `404` when the order is not `paid`: the record exists
 * and the caller may see it, so hiding the reason would send a coordinator
 * looking for an order that is right there.
 */
export const claimCancellationRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const params = yield* HttpRouter.params;
  // `HttpRouter.params` types every segment as optional even when the pattern
  // makes it mandatory. `''` matches no order, so an impossible request answers
  // the same `404` a missing one does rather than throwing.
  const orderId = params.id ?? '';
  const request = yield* HttpServerRequest.HttpServerRequest;
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  if (commandId) {
    yield* ensureCommandInboxIndexes(db);
  }

  const outcome = yield* Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        let claimed: StoredOrder | undefined;
        let replay = false;
        await session.withTransaction(async () => {
          claimed = undefined;
          replay = false;
          // ⚠️ **The command inbox is what tells a redelivery from a rival.**
          // The status write below distinguishes neither: both arrive at an
          // order that is already `cancelling`, and answering them the same way
          // is how six simultaneous cancels restore a vendor's stock six times
          // while refunding once. `sagaCommandId` is stable across attempts of
          // *one* flow and different across two, which is exactly the
          // discrimination the status cannot make — so the two guards are both
          // needed and neither is redundant
          // ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §3).
          if (commandId && !(await claimCommand(db, session, commandId))) {
            replay = true;
            return;
          }
          const updated = await db
            .collection<StoredOrder>(ORDER_COLLECTION)
            .findOneAndUpdate(
              { id: orderId, status: 'paid' },
              { $set: { status: 'cancelling' } },
              {
                returnDocument: 'after',
                projection: { _id: 0 },
                session,
              },
            );
          if (!updated) {
            // ⚠️ **Thrown rather than returned, so the transaction aborts and
            // the command claim above rolls back with it.** Left committed, a
            // genuine retry of this same command would be read as a redelivery
            // of a claim that never happened, and the flow would walk on to
            // refund an order it does not hold.
            throw new NotClaimable();
          }
          claimed = updated;
        });
        return { claimed, replay };
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      error instanceof NotClaimable
        ? error
        : new EntifixConnError('Failed to claim the order', error, {
            orderId,
          }),
  }).pipe(
    Effect.catchIf(
      (error): error is NotClaimable => error instanceof NotClaimable,
      () => Effect.succeed({ claimed: undefined, replay: false }),
    ),
  );

  if (outcome.claimed) {
    return yield* HttpServerResponse.json(
      envelopeFor(outcome.claimed, orderId),
      { status: 200 },
    );
  }

  const existing = yield* Effect.tryPromise({
    try: () =>
      db
        .collection<StoredOrder>(ORDER_COLLECTION)
        .findOne({ id: orderId }, { projection: { _id: 0 } }),
    catch: error =>
      new EntifixConnError('Failed to read the order', error, {
        orderId,
      }),
  });

  if (!existing) return yield* notFound(orderId);

  // A redelivery of *this* command: the claim it is re-sending already
  // succeeded, so answering `409` would make the coordinator compensate a flow
  // that is proceeding correctly.
  if (outcome.replay) {
    return yield* HttpServerResponse.json(envelopeFor(existing, orderId), {
      status: 200,
    });
  }

  // Anything else is a refusal, including — and especially — a *second flow*
  // finding the record already `cancelling`. That one must fail here or the
  // claim protects nothing: everything after it would run twice against an
  // order only one flow holds.
  return yield* HttpServerResponse.json(
    {
      error: 'the order cannot be cancelled',
      code: 'orderNotCancellable',
      detail: `an order in '${existing.status}' cannot be cancelled`,
      orderId,
    },
    { status: 409 },
  );
}).pipe(Effect.catchAll(serverError));

/**
 * Step 1's compensation — give the claim back.
 *
 * ⚠️ **It releases the claim rather than writing `paid` from outside.** The
 * distinction matters because `paid` is written by exactly one thing today, the
 * payment projection, and a route that could set it would be a way to claim
 * money moved when it did not. This only undoes `cancelling`, and the
 * conditional filter is what makes that true rather than intended.
 *
 * ⚠️ **`200` whether or not anything was there**, for the reason every
 * compensation in this fleet answers so: delivery is at-least-once, and a
 * compensation that errors on its second delivery strands a flow that had in
 * fact been fully reversed. The body says which happened.
 */
export const releaseCancellationClaimRoute = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const params = yield* HttpRouter.params;
  const orderId = params.id ?? '';

  const released = yield* Effect.tryPromise({
    try: () =>
      db
        .collection<StoredOrder>(ORDER_COLLECTION)
        .findOneAndUpdate(
          { id: orderId, status: 'cancelling' },
          { $set: { status: 'paid' } },
          { returnDocument: 'after', projection: { _id: 0 } },
        ),
    catch: error =>
      new EntifixConnError('Failed to release the claim', error, {
        orderId,
      }),
  });

  return yield* HttpServerResponse.json({
    id: orderId,
    outcome: released ? 'released' : 'not-claimed',
  });
}).pipe(Effect.catchAll(serverError));

/**
 * Step 4 — close the record and announce it.
 *
 * ⚠️ **The status and the outbox entry commit in one Mongo transaction.** This
 * is the emitter `order.slice.ts` has been declaring since the slice was
 * written; writing the two apart would leave either a cancelled order settlement
 * never hears about, or an announcement of a cancellation that rolled back
 * ([ADR 0028](../../../../docs/adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).
 *
 * ⚠️ **`x-command-id` is claimed inside that transaction.** This step is
 * `retriable` and sits after the pivot, so the coordinator will re-dispatch it
 * until it succeeds — and without the claim each redelivery would write a second
 * `order.cancelled` for one cancellation, which is a second commission reversal
 * at the far end.
 *
 * It answers `200` on a redelivery rather than `409`, because a step the
 * coordinator may only roll forward must not be given a refusal to strand on.
 */
export const settleCancellationRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const params = yield* HttpRouter.params;
  const orderId = params.id ?? '';
  const request = yield* HttpServerRequest.HttpServerRequest;
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  const settled = yield* Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        let written: StoredOrder | undefined;
        await session.withTransaction(async () => {
          written = undefined;
          if (commandId && !(await claimCommand(db, session, commandId))) {
            return;
          }
          const updated = await db
            .collection<StoredOrder>(ORDER_COLLECTION)
            .findOneAndUpdate(
              { id: orderId, status: 'cancelling' },
              { $set: { status: 'cancelled' } },
              {
                returnDocument: 'after',
                projection: { _id: 0 },
                session,
              },
            );
          if (!updated) return;
          written = updated;
          // The announced payload is the order as it now stands. The document
          // *is* the serialized entity — `_id` is projected away above — so it
          // carries the same shape `order.placed` does without a round trip
          // through the entity and back.
          await orderCancelledEntry(db, session, updated);
        });
        return written;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      new EntifixConnError('Failed to settle the cancellation', error, {
        orderId,
      }),
  });

  if (settled) {
    return yield* HttpServerResponse.json(envelopeFor(settled, orderId), {
      status: 200,
    });
  }

  // Either the command was already applied or the order is no longer
  // `cancelling` — a redelivery of this step, or of the flow. Both are answered
  // with what the record says now, because this step may only roll forward.
  const existing = yield* Effect.tryPromise({
    try: () =>
      db
        .collection<StoredOrder>(ORDER_COLLECTION)
        .findOne({ id: orderId }, { projection: { _id: 0 } }),
    catch: error =>
      new EntifixConnError('Failed to read the order', error, {
        orderId,
      }),
  });

  if (!existing) return yield* notFound(orderId);

  return yield* HttpServerResponse.json(envelopeFor(existing, orderId), {
    status: 200,
  });
}).pipe(Effect.catchAll(serverError));
