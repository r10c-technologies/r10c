import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  FulfilProductOrderUC,
  ProductOrder,
} from '@r10c/business-ts-order-management';
import {
  EntifixConnError,
  envelopeEntityName,
  makeEntityEnvelope,
} from '@r10c/entifix-ts-core';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import type { RequestPrincipal } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { ORDER_COLLECTION } from '../outbox';
import { serverError } from './entity-crud';
import { orderScopeFor } from './order-scope';

/** A line as it comes back out of Mongo — data, never an `OrderItem`. */
interface StoredLine {
  readonly vendorId: string;
  readonly fulfilledAt?: Date;
}

/** An order document, as much of it as this route reads. */
interface StoredOrder {
  readonly id: string;
  readonly status: string;
  readonly items?: readonly StoredLine[];
}

/**
 * Which lines this principal may stamp: `undefined` for an operator, one
 * organization for a vendor.
 *
 * It reuses `orderScopeFor` rather than re-reading `partyRole`, so "who is this
 * caller" has one answer in this service. A `buyer` or a `nothing` scope reaches
 * no line — a buyer does not fulfil their own order — and the route answers the
 * same `404` an absent order gets rather than a `403`, which would confirm the
 * order exists to somebody who may not act on it.
 */
const fulfilmentScopeFor = (
  principal: RequestPrincipal,
): { readonly kind: 'operator' | 'vendor' | 'none'; readonly id?: string } => {
  const scope = orderScopeFor(principal);
  if (scope.kind === 'unscoped') return { kind: 'operator' };
  if (scope.kind === 'vendor') {
    return { kind: 'vendor', id: scope.organizationId };
  }
  return { kind: 'none' };
};

const notFound = HttpServerResponse.json(
  {
    error: 'not found',
    code: 'notFound',
    entity: envelopeEntityName(ProductOrder),
  },
  { status: 404 },
);

/**
 * Record that the lines this caller owes have been delivered.
 *
 * ⚠️ **Fulfilment is per line and the status is derived from all of them.** One
 * order spans several vendors, so an order-level `fulfilled` flipped by one of
 * them states something about another's lines that is not true. A vendor stamps
 * the lines naming their organization; the order reaches `fulfilled` only once
 * every line carries a stamp, including the ones this caller could not touch
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §1).
 *
 * ⚠️ **The scope comes from the verified principal, never from the body.** The
 * route takes no body at all: there is nothing here for a caller to author, and
 * a body naming which lines to stamp is a body that can name somebody else's.
 *
 * ⚠️ **`status: 'paid'` sits in the filter, not only in the update** — the same
 * ordering guard the payment projection uses. An order that has been cancelled
 * underneath this request must not be walked forward to `fulfilled`, and a
 * conditional write is what makes that a property of the storage rather than of
 * the gap between the read and the write above it.
 *
 * An order with no line in the caller's scope answers `404`, the same answer an
 * absent one gets.
 */
export const fulfilOrderRoute = (principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;
    const scope = fulfilmentScopeFor(principal);

    if (scope.kind === 'none') return yield* notFound;

    const stored = yield* Effect.tryPromise({
      try: () =>
        db
          .collection<StoredOrder>(ORDER_COLLECTION)
          .findOne({ id: params.id }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the order', error, {
          orderId: params.id,
        }),
    });

    if (!stored) return yield* notFound;

    const lines = stored.items ?? [];
    const owned =
      scope.kind === 'operator' ||
      lines.some(line => line.vendorId === scope.id);
    if (!owned) return yield* notFound;

    if (stored.status !== 'paid') {
      return yield* HttpServerResponse.json(
        {
          error: 'the order cannot be fulfilled',
          code: 'orderNotFulfillable',
          detail: `an order in '${stored.status}' cannot be fulfilled`,
        },
        { status: 409 },
      );
    }

    const decided = FulfilProductOrderUC.run(
      { status: 'paid' },
      lines,
      scope.kind === 'operator' ? undefined : scope.id,
      new Date(),
    );

    // ⚠️ The whole array is written back rather than a positional update. The
    // lines are a `composition` — plain embedded documents — and a `$set` on
    // `items.$[element]` would need an array filter per vendor, which says the
    // same thing in a dialect that cannot be unit-tested without a database.
    const updated = yield* Effect.tryPromise({
      try: () =>
        db
          .collection<StoredOrder>(ORDER_COLLECTION)
          .findOneAndUpdate(
            { id: params.id, status: 'paid' },
            { $set: { items: decided.lines, status: decided.status } },
            { returnDocument: 'after', projection: { _id: 0 } },
          ),
      catch: error =>
        new EntifixConnError('Failed to fulfil the order', error, {
          orderId: params.id,
        }),
    });

    // The conditional write matched nothing, which means the order moved out of
    // `paid` between the read above and here. The same `409` a caller would have
    // got had it moved a moment earlier.
    if (!updated) {
      return yield* HttpServerResponse.json(
        {
          error: 'the order cannot be fulfilled',
          code: 'orderNotFulfillable',
          detail: 'the order changed while it was being fulfilled',
        },
        { status: 409 },
      );
    }

    const key = envelopeEntityName(ProductOrder);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(ProductOrder, updated as never, [
        { rel: 'self', href: `/api/${key}/${params.id}`, method: 'GET' },
        { rel: 'list', href: `/api/${key}`, method: 'GET' },
      ]),
    );
  }).pipe(Effect.catchAll(serverError));
