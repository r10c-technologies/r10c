import { randomUUID } from 'node:crypto';

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { ProductOrder } from '@r10c/business-ts-order-management';
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
import { ORDER_COLLECTION, orderPlacedEntry } from '../outbox';

/** Thrown inside the transaction when this command was already applied. */
class AlreadyPlaced extends Error {}

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * Write one order, and announce it, in one Mongo transaction.
 *
 * ⚠️ **The outbox entry commits with the order or not at all.** Written
 * separately, a crash between the two leaves an order nobody was told about, or
 * an announcement of an order that rolled back — the dual write ADR 0028 exists
 * to close. `order.placed` has no consumer until M4's payment slice, and the
 * entry is still written: retrofitting an outbox under a store that already has
 * rows is strictly more work than opening one with it, and the alternative is
 * adding the event later as a second write, which is the same bug arriving on
 * purpose.
 *
 * ⚠️ **Server-owned: the id, the status and `placedAt`.** A caller that could
 * choose the id could overwrite another buyer's order; a body arriving as
 * `paid` would claim money nobody took. The lines are **not** rewritten — the
 * price on each was captured at checkout from what the buyer was shown, and
 * re-reading it here would charge them today's price for yesterday's basket.
 *
 * ⚠️ **`x-command-id` is claimed in the same transaction**, for the reason
 * `POST /api/reservation` claims one: this is a saga step, delivery is
 * at-least-once, and a redelivery must answer with the order it already wrote
 * rather than writing a second one against holds that were only ever taken once
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)).
 */
export const placeOrderRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const order = yield* readEntityEnvelope(ProductOrder, body);

  if (order.items.length === 0) {
    // An order with no lines is not a sale. It would settle to nothing, show
    // the buyer an empty receipt, and hold no stock — so it is refused where it
    // is cheapest to refuse.
    return yield* HttpServerResponse.json(
      {
        error: 'invalid request body',
        code: 'invalidBody',
        detail: 'an order must carry at least one item',
      },
      { status: 400 },
    );
  }

  order.id = randomUUID();
  order.status = 'pending';
  order.placedAt = new Date();

  const document = serializeEntity(ProductOrder, order);
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  if (commandId) {
    yield* ensureCommandInboxIndexes(db);
  }

  const placed = yield* Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          if (commandId && !(await claimCommand(db, session, commandId))) {
            throw new AlreadyPlaced();
          }
          await db
            .collection(ORDER_COLLECTION)
            .insertOne({ ...document, id: order.id, commandId }, { session });
          await orderPlacedEntry(db, session, order);
        });
        return true;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      error instanceof AlreadyPlaced
        ? error
        : new EntifixConnError('Failed to write the order', error, {
            orderId: String(order.id),
          }),
  }).pipe(
    Effect.catchIf(
      (error): error is AlreadyPlaced => error instanceof AlreadyPlaced,
      () => Effect.succeed(false),
    ),
  );

  const key = envelopeEntityName(ProductOrder);

  if (!placed) {
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .collection(ORDER_COLLECTION)
          .findOne({ commandId }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the claimed order', error, {
          commandId,
        }),
    });
    // `200`, not `409`: a coordinator that could not tell a duplicate from a
    // refusal would compensate an order it believes was never written — and
    // release holds that are, in fact, still backing it.
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(ProductOrder, existing as never, []),
      { status: 200 },
    );
  }

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(ProductOrder, order, [
      { rel: 'self', href: `/api/${key}/${String(order.id)}`, method: 'GET' },
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

/**
 * Undo a written order — the saga's compensation, not a buyer's cancel.
 *
 * ⚠️ **Deleted rather than marked `cancelled`, and the distinction is real.** A
 * compensation reverses a step that should not have happened; a cancellation is
 * a business event with its own record, its own timing and its own money
 * consequences (ADR 0039's "a refund is not an uncharge"). Leaving a
 * `cancelled` row here would put an order in a buyer's history that they never
 * completed and were never charged for.
 *
 * Answers `200` whether or not anything was there, for the reason the
 * reservation verbs do: at-least-once delivery, and an error on the second
 * delivery strands a saga that was in fact reversed.
 */
export const deleteOrderRoute = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const params = yield* HttpRouter.params;

  const outcome = yield* Effect.tryPromise({
    try: () => db.collection(ORDER_COLLECTION).deleteOne({ id: params.id }),
    catch: error =>
      new EntifixConnError('Failed to delete the order', error, {
        orderId: params.id,
      }),
  });

  return yield* HttpServerResponse.json({
    id: params.id,
    outcome: outcome.deletedCount > 0 ? 'deleted' : 'not-found',
  });
}).pipe(Effect.catchAll(serverError));
