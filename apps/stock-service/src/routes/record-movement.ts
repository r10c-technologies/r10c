import { randomUUID } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  isConsistentMovement,
  isMovementReason,
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
  ensureStockItemIndexes,
  isDuplicateKeyError,
  STOCK_ITEM_COLLECTION,
} from '../stock-item-index';
import { serverError } from './entity-crud';

/**
 * Record one movement, and move the running total by it — in one Mongo
 * transaction.
 *
 * **This is the only write this service accepts**, and it is a plain REST
 * `POST` rather than the `202` command protocol. The offering create is plain
 * REST because no member of it is server-owned; the specification create runs
 * through the transaction engine because a Redis sequence assigns its `code`,
 * and drawing from that sequence is the non-transactional side effect the saga
 * exists to coordinate. A movement has neither: it is one database, one
 * transaction, and this slice declares no published event, so there is no
 * outbox entry to commit beside it. Running it through accept/execute would buy
 * a `202`, a tracker record and an outbox row for nothing.
 *
 * ⚠️ **The ledger row and the fold are one transaction or they are a lie.**
 * Written separately, a crash between them leaves either a total no movement
 * explains — which is exactly what makes a fold unreconcilable — or a movement
 * the total never absorbed. The append-only ledger is the system of record and
 * `StockItem` is its materialized fold
 * ([ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * ⚠️ **`$inc`, never a computed absolute value.** Reading `onHand` and writing
 * `onHand + quantity` loses an update between two requests **inside a single
 * process** — no amount of service topology fixes it, and the ledger cannot
 * even detect it afterwards because both writes are plausible. The item is
 * upserted on its first movement, so a vendor's first receipt creates the row
 * rather than requiring one to exist.
 */
export const recordMovementRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const movement = yield* readEntityEnvelope(StockMovement, body);

  // ⚠️ **The enum is checked here, because deserialization does not check it.**
  // `reason` is declared `type: 'enum'` with `enumValues`, and that metadata
  // drives the *control* a client renders — it is not a parser. A body naming
  // `shrinkage` deserializes cleanly, and the value would reach the ledger and
  // sit there permanently: the reasons are a closed set precisely so that "why
  // is this vendor's stock wrong?" is answerable by query, and one free-form
  // value spent in anger takes that away.
  //
  // It is `invalidBody` rather than `inconsistentMovement` because nothing is
  // inconsistent — the caller named a reason that does not exist, which is a
  // different mistake and a different fix.
  if (!isMovementReason(movement.reason)) {
    return yield* HttpServerResponse.json(
      {
        error: 'invalid request body',
        code: 'invalidBody',
        detail: `"${String(movement.reason)}" is not a movement reason`,
      },
      { status: 400 },
    );
  }

  // The domain's rule, checked before anything is written: a signed quantity
  // that contradicts its reason, or one that is zero, `NaN` or infinite. The
  // last of those is why this is a refusal rather than a nicety — `$inc` by
  // `NaN` writes `NaN`, which no later movement can move back.
  if (!isConsistentMovement(movement.reason, movement.quantity)) {
    return yield* HttpServerResponse.json(
      {
        error: 'inconsistent movement',
        code: 'inconsistentMovement',
        detail: `a movement of ${String(movement.quantity)} cannot be a ${movement.reason}`,
      },
      { status: 400 },
    );
  }

  // Server-owned, exactly as the save route owns the id from the path: a client
  // that could choose it could overwrite another movement in this vendor's
  // ledger, and an append-only log with an editable key is not append-only.
  movement.id = randomUUID();
  const document = serializeEntity(StockMovement, movement);
  const movementCollection = envelopeEntityName(StockMovement);
  const itemCollection = STOCK_ITEM_COLLECTION;

  // Before the first write, and per handle: a tenant database appears when it
  // is first written to, so there is no boot moment at which this index could
  // have been created. It is what makes one offering have one total — see the
  // measurement recorded on it.
  yield* ensureStockItemIndexes(db);

  const commit = async () => {
    const session = client.startSession();
    try {
      // `withTransaction`, never a hand-rolled start/commit: an election
      // aborts an in-flight transaction with a `TransientTransactionError`
      // the *application* is expected to retry, and a single-node dev replica
      // set never raises one. Nothing non-transactional runs inside, so a
      // retry replays the same two writes rather than minting a second id.
      await session.withTransaction(async () => {
        await db
          .collection(movementCollection)
          .insertOne({ ...document, id: movement.id }, { session });
        // `$setOnInsert` deliberately does not name `onHand`: setting a field
        // an update also `$inc`s is a conflict Mongo rejects outright, and
        // `$inc` on an absent field creates it at the increment's value —
        // which is the correct opening balance for a first receipt.
        await db.collection(itemCollection).updateOne(
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

  yield* Effect.tryPromise({
    try: async () => {
      // ⚠️ **One retry, and it is not optional.** Two receipts for the same
      // offering arriving together both find no document and both try to
      // insert; the unique index lets exactly one of them succeed and refuses
      // the other with a duplicate key. Retried, the loser now finds the
      // winner's document and takes the update branch, so both increments land.
      // Without this, the index would turn a silently split total into a `500`
      // on a request the vendor did nothing wrong in — which is a different bug,
      // not a fix.
      //
      // Retried once rather than in a loop: after the first attempt the
      // document provably exists, so a second duplicate key is not this race
      // and must not be swallowed as if it were.
      try {
        await commit();
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        await commit();
      }
    },
    catch: error =>
      new EntifixConnError(
        'Failed to commit the movement and its fold',
        error,
        {
          offeringId: movement.offeringId,
        },
      ),
  });

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(StockMovement, movement, [
      {
        rel: 'self',
        href: `/api/${movementCollection}/${String(movement.id)}`,
        method: 'GET',
      },
      { rel: 'list', href: `/api/${movementCollection}`, method: 'GET' },
      // The fold this movement just moved. The client gets the address of the
      // new total without this response inventing a second payload shape for
      // an entity it is not returning.
      {
        rel: 'stock-item',
        href: `/api/${itemCollection}?rsql=offeringId==${movement.offeringId}`,
        method: 'GET',
      },
    ]),
    { status: 201 },
  );
}).pipe(
  Effect.catchAll(error =>
    // A malformed envelope is the client's fault, not ours. `EntifixError`s are
    // plain `Error`s carrying a `_tag` field rather than `Data.TaggedError`s,
    // so they are discriminated with `instanceof` — `Effect.catchTag` would not
    // match.
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
