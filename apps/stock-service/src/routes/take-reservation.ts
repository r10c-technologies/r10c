import { randomUUID } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  isReservableQuantity,
  Reservation,
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
import { ReservationTtlSecondsTag } from '../reservation-ttl';
import { STOCK_ITEM_COLLECTION } from '../stock-item-index';
import { serverError } from './entity-crud';

const MILLISECONDS = 1_000;

/**
 * Thrown inside the transaction when the conditional write matches nothing, so
 * the hold and the counter never land half-written.
 *
 * A sentinel class rather than a flag returned from the callback:
 * `session.withTransaction` commits whatever its callback returns normally, and
 * the only way to say "abort this" is to throw. It is discriminated by
 * `instanceof` on the way out, so a genuine driver failure is never mistaken for
 * an out-of-stock answer.
 */
class InsufficientStock extends Error {}

/**
 * Thrown when this command id has already been claimed — a redelivery.
 *
 * A sentinel for the same reason {@link InsufficientStock} is: the only way to
 * abort `session.withTransaction` is to throw, and discriminating on the way out
 * keeps a duplicate from being mistaken for a driver failure.
 */
class AlreadyTaken extends Error {}

/**
 * Take a time-limited hold on a vendor's stock.
 *
 * **This is ADR 0023's crossing, and the only route in the fleet that has one.**
 * It is mounted on `crossed(...)`, so the organization comes from an explicit
 * `x-organization-id` honoured only after a crossing token proved the caller is
 * the fleet — never from a session, because the caller acting here is checkout,
 * and a buyer's session names no organization and never will. The organization
 * comes from the *item*: the vendor that owns the offering being reserved.
 *
 * ⚠️ **A purchase reserves; it does not decrement.** `onHand` is untouched —
 * the goods are still physically there — and `reserved` rises, so
 * `availability = onHand - reserved` falls. The design is forced by **payment
 * latency**, not by service topology: a database transaction cannot be held open
 * across an external payment call, so reservations would be required even with a
 * single database
 * ([ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * ⚠️ **The guard is the write, not a check before it.** The filter carries
 * `onHand - reserved >= quantity` and the update carries `$inc`, so the decision
 * and the mutation are one document operation that no concurrent request can
 * interleave with. Reading availability first and then incrementing is the lost
 * update this shape exists to make impossible, and it would be invisible to
 * every sequential test. `matchedCount === 0` **is** the out-of-stock answer:
 * no lock to acquire, no contention ceiling, and no serializing every purchase
 * of a popular item through one key.
 *
 * ⚠️ **No upsert, deliberately.** An offering with no `StockItem` row has never
 * received stock, so it matches nothing and answers `409` — which is correct.
 * Upserting here would mint a row promising stock that was never received.
 *
 * ⚠️ **`x-command-id` is claimed in the same transaction as the hold.** The saga
 * dispatches this step at-least-once, and the id here is server-minted — so
 * without a claim a redelivered command takes a *second* hold against the same
 * line, and the vendor's availability is quietly wrong while the ledger stays
 * perfectly correct. The claim commits with the hold or not at all: claimed
 * outside, a crash between the two records a hold that was never taken and
 * refuses every retry as a duplicate
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md), reusing #178's
 * inbox shape).
 *
 * The header is **optional**, and its absence is not a hole. A caller with no
 * command id gets today's behaviour, because there is nothing to be idempotent
 * *about*: only a retried dispatch can duplicate, and only a dispatcher has an
 * id to retry under.
 */
export const takeReservationRoute = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const ttlSeconds = yield* ReservationTtlSecondsTag;

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const reservation = yield* readEntityEnvelope(Reservation, body);

  // The domain's rule, checked before anything is written. Zero holds nothing,
  // a negative quantity would *release* stock through the route that takes it,
  // and `NaN` reaches `$inc` and writes `NaN` into `reserved` — which no later
  // reservation, release or adjustment can move back.
  if (!isReservableQuantity(reservation.quantity)) {
    return yield* HttpServerResponse.json(
      {
        error: 'invalid request body',
        code: 'invalidBody',
        detail: `${String(reservation.quantity)} is not a reservable quantity`,
      },
      { status: 400 },
    );
  }

  // Server-owned, all three. The id for the reason the movement's is — a caller
  // that could choose it could overwrite another hold. `status` because a hold
  // opens `held` by definition and arriving as `converted` would promise stock
  // against a payment nobody made. `expiresAt` because a client that named its
  // own expiry could hold a vendor's stock forever.
  reservation.id = randomUUID();
  reservation.status = 'held';
  reservation.expiresAt = new Date(Date.now() + ttlSeconds * MILLISECONDS);

  const document = serializeEntity(Reservation, reservation);
  const reservationCollection = envelopeEntityName(Reservation);
  const commandId = request.headers[COMMAND_ID_HEADER]?.trim();

  if (commandId) {
    // Per handle, for the reason the stock-item index is: a tenant database
    // appears on its first write, so there is no boot moment at which this
    // index could have been created.
    yield* ensureCommandInboxIndexes(db);
  }

  const held = yield* Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        // `withTransaction` rather than a hand-rolled start/commit, for the
        // reason the movement route records: an election aborts an in-flight
        // transaction with a `TransientTransactionError` the *application* is
        // expected to retry. Nothing non-transactional runs inside, so a retry
        // replays the same two writes rather than minting a second id.
        await session.withTransaction(async () => {
          if (commandId && !(await claimCommand(db, session, commandId))) {
            throw new AlreadyTaken();
          }
          const outcome = await db.collection(STOCK_ITEM_COLLECTION).updateOne(
            {
              offeringId: reservation.offeringId,
              // `$expr` because the condition compares two fields of the same
              // document against a constant, which a plain query operator
              // cannot express.
              $expr: {
                $gte: [
                  { $subtract: ['$onHand', '$reserved'] },
                  reservation.quantity,
                ],
              },
            },
            { $inc: { reserved: reservation.quantity } },
            { session },
          );
          if (outcome.matchedCount === 0) {
            throw new InsufficientStock();
          }
          await db
            .collection(reservationCollection)
            .insertOne(
              // `commandId` rides on the document rather than living only in
              // the inbox: a redelivery has to answer with *this* hold, and
              // joining two collections to find it would be a second read on
              // the hot path for a case that is rare by design.
              { ...document, id: reservation.id, commandId },
              { session },
            );
        });
        return true;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      error instanceof InsufficientStock || error instanceof AlreadyTaken
        ? error
        : new EntifixConnError('Failed to take the reservation', error, {
            offeringId: reservation.offeringId,
          }),
  }).pipe(
    Effect.catchIf(
      (error): error is InsufficientStock | AlreadyTaken =>
        error instanceof InsufficientStock || error instanceof AlreadyTaken,
      error =>
        Effect.succeed(
          error instanceof AlreadyTaken ? ('duplicate' as const) : false,
        ),
    ),
  );

  if (held === 'duplicate') {
    // The hold this command already took. `409` would read as "out of stock" to
    // a dispatcher that cannot tell the two apart, and a compensation would then
    // release a hold it believes was never taken; `200` says plainly that the
    // command has been applied and the saga may proceed.
    const existing = yield* Effect.tryPromise({
      try: () =>
        db
          .collection(reservationCollection)
          .findOne({ commandId }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the claimed reservation', error, {
          commandId,
        }),
    });
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(Reservation, existing as never, []),
      { status: 200 },
    );
  }

  if (!held) {
    // Not a system error and not the caller's mistake: the vendor does not have
    // it. `409` rather than `422` for the same reason `noActiveOrganization` is
    // one — the request is well formed and conflicts with the current state.
    return yield* HttpServerResponse.json(
      {
        error: 'insufficient stock',
        code: 'insufficientStock',
        detail: `${String(reservation.quantity)} is more than is available of ${reservation.offeringId}`,
      },
      { status: 409 },
    );
  }

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(Reservation, reservation, [
      // ⚠️ These are the **vendor's** reads, not this caller's: they are
      // session-guarded by `stock-management:reservation:read`, which no
      // crossing token carries. They are still the record's real addresses, and
      // the alternative — inventing a second, token-guarded read surface for a
      // caller that already holds the response — would widen the crossing for
      // nothing.
      {
        rel: 'self',
        href: `/api/${reservationCollection}/${String(reservation.id)}`,
        method: 'GET',
      },
      { rel: 'list', href: `/api/${reservationCollection}`, method: 'GET' },
      {
        rel: 'stock-item',
        href: `/api/${STOCK_ITEM_COLLECTION}?rsql=offeringId==${reservation.offeringId}`,
        method: 'GET',
      },
    ]),
    { status: 201 },
  );
}).pipe(
  Effect.catchAll(error =>
    // A malformed envelope is the client's fault. `EntifixError`s are plain
    // `Error`s carrying a `_tag` field rather than `Data.TaggedError`s, so they
    // are discriminated with `instanceof` — `Effect.catchTag` would not match.
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
