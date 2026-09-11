import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  CancelProductOrderUC,
  MULTI_VENDOR_ORDER,
  ORDER_NOT_CANCELLABLE,
  ProductOrder,
} from '@r10c/business-ts-order-management';
import {
  EntifixConnError,
  EntifixLogicError,
  envelopeEntityName,
  makeEntityEnvelope,
} from '@r10c/entifix-ts-core';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import type { RequestPrincipal } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import {
  type CancelRefusal,
  verifyCancelCapability,
} from '../cancel-capability';
import {
  CancellationCoordinatorUrl,
  CancellationCrossingToken,
} from '../coordinator-config';
import { ORDER_COLLECTION } from '../outbox';
import { serverError } from './entity-crud';
import { orderScopeFor } from './order-scope';

/** The crossing header the coordinator's own guard reads. */
const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/** The flow this service starts, by the name `SAGAS` registers it under. */
const CANCELLATION_SAGA = 'cancellation';

/** A line as it comes back out of Mongo — data, never an `OrderItem`. */
interface StoredLine {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
}

/** An order document, as much of it as these routes read. */
interface StoredOrder {
  readonly id: string;
  readonly status: string;
  readonly items?: readonly StoredLine[];
  readonly cancelDigest?: string;
  readonly cancelWindowEndsAt?: Date | string;
}

const notFound = HttpServerResponse.json(
  {
    error: 'not found',
    code: 'notFound',
    entity: envelopeEntityName(ProductOrder),
  },
  { status: 404 },
);

const readOrder = (id: string) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    return yield* Effect.tryPromise({
      try: () =>
        db
          .collection<StoredOrder>(ORDER_COLLECTION)
          .findOne({ id }, { projection: { _id: 0 } }),
      catch: error =>
        new EntifixConnError('Failed to read the order', error, {
          orderId: id,
        }),
    });
  });

/**
 * The inputs the cancellation flow needs, built from the order this service
 * already holds.
 *
 * ⚠️ **The stock step's cardinality comes from here rather than from
 * `fanOutFrom`.** An earlier step creates nothing this one has to address — a
 * restoration is a new movement rather than the reversal of a hold — and the
 * entry route already holds the lines, each carrying the `vendorId` that becomes
 * the crossing's `x-organization-id`
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §7).
 */
const inputsFor = (order: StoredOrder) => ({
  claim: [{ body: { orderId: order.id } }],
  refund: [{ body: { orderId: order.id } }],
  'restore-stock': (order.items ?? []).map(line => ({
    // The organization comes from the *line*, because the buyer behind a
    // cancellation names none and never will.
    organizationId: line.vendorId,
    body: {
      meta: { type: 'entity', entity: 'stock-movement' },
      data: { offeringId: line.offeringId, quantity: line.quantity },
    },
  })),
  settle: [{ body: { orderId: order.id } }],
});

/** Which step refused, as a code the browser can render. */
const refusalCode = (payload: unknown): string => {
  const outcomes = (payload as { data?: { outcomes?: unknown } } | undefined)
    ?.data?.outcomes;
  if (!Array.isArray(outcomes)) return ORDER_NOT_CANCELLABLE;
  const failed = outcomes.find(
    (outcome: { error?: unknown }) => outcome.error !== undefined,
  ) as { stepId?: string } | undefined;
  // A refused refund is the only other way a cancellation compensates, and it
  // is a different fact for the customer: the order is still theirs and still
  // paid for, rather than past cancelling.
  return failed?.stepId === 'refund' ? 'refundDeclined' : ORDER_NOT_CANCELLABLE;
};

/**
 * Start the cancellation flow, having already decided the caller may.
 *
 * ⚠️ **This service is both the caller and a participant**, which is the cycle
 * ADR 0058 §6 accepts deliberately: a cancellation's authority is a buyer's
 * capability or a vendor's session, and neither is verifiable anywhere but here.
 * Letting the coordinator check it would put an order's authorization rule in a
 * slice that must not know what an order is.
 */
const startCancellation = (order: StoredOrder) =>
  Effect.gen(function* () {
    const coordinatorUrl = yield* CancellationCoordinatorUrl;
    const crossingToken = yield* CancellationCrossingToken;

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${coordinatorUrl}/saga/${CANCELLATION_SAGA}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [CROSSING_TOKEN_HEADER]: crossingToken,
          },
          body: JSON.stringify({ inputs: inputsFor(order) }),
        }),
      catch: error =>
        new EntifixConnError('Failed to reach the coordinator', error, {
          orderId: order.id,
        }),
    });

    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: error => error,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (response.status === 201) {
      // The order as it now stands, read back rather than assumed: the flow's
      // last step is the one that wrote `cancelled`, and echoing what this
      // route believed a moment ago would be a receipt that guesses.
      const settled = yield* readOrder(order.id);
      const key = envelopeEntityName(ProductOrder);
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(ProductOrder, (settled ?? order) as never, [
          { rel: 'self', href: `/api/${key}/${order.id}`, method: 'GET' },
          { rel: 'list', href: `/api/${key}`, method: 'GET' },
        ]),
      );
    }

    if (response.status === 409) {
      // Fully compensated: nothing moved, and the order is exactly as it was.
      return yield* HttpServerResponse.json(
        {
          error: 'the order was not cancelled',
          code: refusalCode(payload),
          orderId: order.id,
        },
        { status: 409 },
      );
    }

    // Stranded past the pivot, or the coordinator itself failed. Either way the
    // order is visibly `cancelling` rather than silently wrong, which is the
    // state a sweep or a person can act on.
    return yield* serverError(
      `the cancellation coordinator answered ${String(response.status)}`,
    );
  });

/**
 * A vendor or an operator cancelling an order.
 *
 * Session and `order-management:product-order:cancel`, and **no crossing
 * token** — the sibling route below takes the buyer's capability and no session.
 * Each route accepts exactly one credential, because a route taking either makes
 * the weaker one the security level
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §4).
 *
 * ⚠️ **A vendor may cancel only an order that is theirs alone.** A basket
 * spanning two vendors was paid for on one capture, and partial cancellation is
 * out of scope by decision rather than by omission — so the answer is `409` and
 * a code that says an operator can, rather than a cancellation of one vendor's
 * share.
 */
export const cancelOrderRoute = (principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    // `HttpRouter.params` types every segment as optional even when the pattern
    // makes it mandatory. `''` matches no order, so an impossible request gets
    // the same `404` a missing one does.
    const orderId = params.id ?? '';
    const scope = orderScopeFor(principal);

    // A buyer's session reaches no cancellation here: the storefront's buyer
    // holds no session at all, and an account that placed an order cancels it
    // with the capability route below. `nothing` is a caller whose own records
    // cannot be identified.
    if (scope.kind === 'buyer' || scope.kind === 'nothing') {
      return yield* notFound;
    }

    const order = yield* readOrder(orderId);
    if (!order) return yield* notFound;

    const vendorScope =
      scope.kind === 'vendor' ? scope.organizationId : undefined;
    if (
      vendorScope !== undefined &&
      !(order.items ?? []).some(line => line.vendorId === vendorScope)
    ) {
      // Not this vendor's order at all — the same `404` an absent one gets,
      // rather than a `409` that would confirm it exists.
      return yield* notFound;
    }

    const refused = yield* Effect.try({
      try: () => {
        CancelProductOrderUC.run(
          { status: order.status as never },
          order.items ?? [],
          vendorScope,
        );
        return undefined;
      },
      catch: error => error,
    }).pipe(
      Effect.catchAll(error =>
        Effect.succeed(
          error instanceof EntifixLogicError
            ? ((error.details as { code?: string } | undefined)?.code ??
                ORDER_NOT_CANCELLABLE)
            : ORDER_NOT_CANCELLABLE,
        ),
      ),
    );

    if (refused !== undefined) {
      return yield* HttpServerResponse.json(
        {
          error:
            refused === MULTI_VENDOR_ORDER
              ? 'the order names another vendor'
              : 'the order cannot be cancelled',
          code: refused,
          orderId: order.id,
        },
        { status: 409 },
      );
    }

    return yield* startCancellation(order);
  }).pipe(Effect.catchAll(serverError));

/**
 * A buyer cancelling their own order, with the nonce from their receipt.
 *
 * ⚠️ **No session, and no crossing token either.** The storefront's buyer is
 * anonymous by design, so the authority is the nonce whose SHA-256 digest the
 * order itself carries — and the order is the authority rather than the
 * credential: the digest says which nonce is right and the stored timestamp says
 * until when, which is what makes the window revocable
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §5).
 *
 * ⚠️ **Every refusal answers `401` under one code.** `verifyCancelCapability`
 * distinguishes a missing capability from a wrong nonce from a closed window,
 * and that distinction is written to the log rather than to the caller: telling
 * an unauthenticated caller which of the three they hit is telling them how to
 * get closer.
 *
 * ⚠️ **An absent order answers `401` too, not `404`.** A `404` here would let
 * anyone enumerate which order ids exist by presenting a nonce they do not have.
 */
export const buyerCancelOrderRoute = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const orderId = params.id ?? '';
  const request = yield* HttpServerRequest.HttpServerRequest;

  const body = yield* request.json.pipe(
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
  const nonce = (body as { cancelNonce?: unknown } | undefined)?.cancelNonce;

  const order = yield* readOrder(orderId);

  const refusal: CancelRefusal | undefined =
    order === null
      ? 'noCapability'
      : verifyCancelCapability(
          order,
          typeof nonce === 'string' ? nonce : undefined,
          new Date(),
        );

  if (order === null || refusal !== undefined) {
    yield* Effect.logInfo('a buyer cancellation was refused').pipe(
      Effect.annotateLogs({ orderId, refusal: refusal ?? 'noCapability' }),
    );
    return yield* HttpServerResponse.json(
      {
        error: 'the order cannot be cancelled from here',
        code: 'cancelNotAuthorized',
      },
      { status: 401 },
    );
  }

  // `order` is defined here: an absent one refuses above as `noCapability`.
  if (order.status !== 'paid') {
    return yield* HttpServerResponse.json(
      {
        error: 'the order cannot be cancelled',
        code: ORDER_NOT_CANCELLABLE,
        orderId: order.id,
      },
      { status: 409 },
    );
  }

  return yield* startCancellation(order);
}).pipe(Effect.catchAll(serverError));
