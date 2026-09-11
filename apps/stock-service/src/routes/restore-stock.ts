import { randomUUID } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  isConsistentMovement,
  StockMovement,
} from '@r10c/business-ts-stock-management';
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
import {
  ensureStockItemIndexes,
  isDuplicateKeyError,
  STOCK_ITEM_COLLECTION,
} from '../stock-item-index';
import { serverError } from './entity-crud';

/** Thrown inside the transaction when this command was already applied. */
class AlreadyRestored extends Error {}

/**
 * Put the goods back after a paid order was cancelled — one `+quantity`
 * movement and the fold it moves, in one Mongo transaction.
 *
 * ⚠️ **A new movement, not an un-conversion, and the difference is not
 * stylistic.** By the time an order is `paid` its reservation is `converted`,
 * `transitionReservation` has written the `−quantity` sale movement and
 * decremented `onHand`, and the reservation's states are terminal. There is no
 * hold left to release and nothing to reverse: the ledger is append-only, so a
 * correction is a *new* row. `MovementReasons` has declared `cancellation` for
 * exactly this since ADR 0010, which named that set as the extension point
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * ⚠️ **A crossing token and an explicit `x-organization-id`, no session** —
 * exactly like `POST /api/reservation` and for the same reason: the organization
 * comes from the cancelled *line*, because the buyer cancelling holds no
 * membership in the vendor they bought from (ADR 0023).
 *
 * ⚠️ **`reason` is server-owned.** This route restores; it is not a second way
 * into the ledger. A caller that could name the reason could write a `receipt`
 * through a crossing token, which is why the crossing permission is
 * `stock-movement:restore` rather than the `stock-movement:write` a vendor's own
 * session holds.
 *
 * ⚠️ **`x-command-id` is claimed in the same transaction as the write**, because
 * the cancellation saga's stock step sits *after* its pivot and is therefore
 * `retriable` — the engine re-dispatches it on a stable command id until it
 * succeeds, and a restoration that ran twice hands a vendor stock they never got
 * back.
 */
export const restoreStockRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const movement = yield* readEntityEnvelope(StockMovement, body);

  // Server-owned, and set before the consistency check so the check is about
  // the quantity the caller sent rather than the reason they hoped for.
  movement.reason = 'cancellation';

  // `movementDirection('cancellation')` is `'in'`, so this refuses a zero, a
  // negative, a `NaN` and an infinity for free. The last matters most: `$inc`
  // by `NaN` writes `NaN`, and no later movement moves it back.
  if (!isConsistentMovement(movement.reason, movement.quantity)) {
    return yield* HttpServerResponse.json(
      {
        error: 'inconsistent movement',
        code: 'inconsistentMovement',
        detail: `a restoration of ${String(movement.quantity)} is not a quantity going back`,
      },
      { status: 400 },
    );
  }

  movement.id = randomUUID();
  const document = serializeEntity(StockMovement, movement);
  const movementCollection = envelopeEntityName(StockMovement);
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  yield* ensureStockItemIndexes(db);

  if (commandId) {
    yield* ensureCommandInboxIndexes(db);
  }

  const commit = async () => {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (commandId && !(await claimCommand(db, session, commandId))) {
          throw new AlreadyRestored();
        }
        await db
          .collection(movementCollection)
          .insertOne({ ...document, id: movement.id, commandId }, { session });
        // Upserted for the same reason a receipt is: a vendor whose `StockItem`
        // row was never written still gets an honest opening balance, and
        // `$setOnInsert` must not name a field `$inc` also touches.
        await db.collection(STOCK_ITEM_COLLECTION).updateOne(
          { offeringId: movement.offeringId },
          {
            $inc: { onHand: movement.quantity },
            $setOnInsert: {
              id: randomUUID(),
              offeringId: movement.offeringId,
              reserved: 0,
            },
          },
          { upsert: true, session },
        );
      });
    } finally {
      await session.endSession();
    }
  };

  const written = yield* Effect.tryPromise({
    try: async () => {
      // One retry on a duplicate key, the same race `POST /api/stock-movement`
      // documents: two restorations for one offering both find no `StockItem`,
      // the unique index lets one insert win, and the loser now takes the
      // update branch. The command claim rolled back with the aborted
      // transaction, so the retry re-claims cleanly.
      try {
        await commit();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await commit();
      }
      return true;
    },
    catch: error =>
      error instanceof AlreadyRestored
        ? error
        : new EntifixConnError('Failed to commit the restoration', error, {
            offeringId: movement.offeringId,
          }),
  }).pipe(
    Effect.catchIf(
      (error): error is AlreadyRestored => error instanceof AlreadyRestored,
      () => Effect.succeed(false),
    ),
  );

  if (!written) {
    // The replay answers the movement the first delivery wrote, found by the
    // command id stored on the row itself — a second read of an inbox document
    // would say only that something happened, not what.
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .collection(movementCollection)
          .findOne({ commandId }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the claimed restoration', error, {
          commandId,
        }),
    });

    return yield* HttpServerResponse.json(
      makeEntityEnvelope(StockMovement, existing as never, []),
      { status: 200 },
    );
  }

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(StockMovement, movement, [
      {
        rel: 'self',
        href: `/api/${movementCollection}/${String(movement.id)}`,
        method: 'GET',
      },
      { rel: 'list', href: `/api/${movementCollection}`, method: 'GET' },
      {
        rel: 'stock-item',
        href: `/api/${STOCK_ITEM_COLLECTION}?rsql=offeringId==${movement.offeringId}`,
        method: 'GET',
      },
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
