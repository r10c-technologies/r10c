import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';

import { transitionReservation } from '../reservation-transition';
import { serverError } from './entity-crud';

/**
 * The two ways a hold ends, and they are **verbs rather than a save**.
 *
 * ⚠️ There is deliberately no `PUT` over a `Reservation`. A generic save would
 * be the read-modify-write [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)
 * forbids, and it would let a caller rewrite `expiresAt` or `quantity` after the
 * fact — which is a hold that never expires, granted by a client.
 *
 * Both answer **`200` when the hold was already gone**, not `404` and not `409`.
 * That is not laxity: these are the compensations `runSaga` dispatches, an
 * at-least-once dispatch may deliver one twice, and a compensation that errors
 * on its second delivery strands a saga that had in fact been fully reversed
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)). The body still
 * says which happened, so a caller that cares can tell.
 */
const endReservation = (
  to: 'released' | 'converted',
  reason?: 'sale',
) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;

    const outcome = yield* transitionReservation(
      client,
      db,
      params.id ?? '',
      to,
      reason,
    );

    return yield* HttpServerResponse.json({
      id: params.id,
      status: to,
      // `transitioned` says this call moved it; `not-held` says it was already
      // out of `held` — released, converted, or swept — before this call
      // arrived.
      outcome,
    });
  }).pipe(Effect.catchAll(serverError));

/** Give the claim back. `onHand` is untouched; the goods never left. */
export const releaseReservationRoute = endReservation('released');

/**
 * Convert the hold to a sale.
 *
 * This is where stock actually leaves: `reserved` falls **and** `onHand` falls,
 * against a `sale` movement written in the same transaction, so the ledger and
 * its fold can never disagree about why.
 */
export const convertReservationRoute = endReservation('converted', 'sale');
