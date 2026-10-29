import type {
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  IdempotencyStoreTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  envelopeEntityName,
  IDEMPOTENCY_KEY_HEADER,
  isFailure,
  makeEntityEnvelope,
  parseIdempotencyKey,
  readEntityEnvelope,
} from '@entifix/core';
import {
  type EntityRouteContext,
  type EntityRouteLinks,
  makeEntityRoutes,
  type MetadataCompositions,
  requireCrossing,
  requireIdempotencyKey,
  requirePermission,
  routeFailure,
  type ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import {
  CANCEL_PRODUCT_ORDER,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  type CancelResult,
  CancelWindowSeconds,
  FULFIL_PRODUCT_ORDER,
  fulfilOrder,
  isMultiVendorRefusal,
  ORDER_NOT_CANCELLABLE,
  orderNarrowing,
  OrderRefused,
  orderScopeFor,
  PAYMENT_PENDING,
  placeOrder,
  ProductOrder,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import type { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link productOrderRoutes}. */
export type ProductOrderRouteServices =
  | EntityRepositoryFactoryTag
  | IdempotencyStoreTag
  | ProductOrderStoreTag
  | SagaStarterTag
  | CancelWindowSeconds
  | TokenServiceTag
  | PolicyDecisionTag
  | ServiceCrossingTokenTag
  | ServiceCrossingPolicyTag;

const KEY = envelopeEntityName(ProductOrder);
const BASE = `/api/${KEY}` as const;

const recordLinks = (orderId: string) => [
  { rel: 'self', href: `${BASE}/${orderId}`, method: 'GET' } as const,
  { rel: 'list', href: BASE, method: 'GET' } as const,
];

const envelopeOf = (order: ProductOrder) =>
  makeEntityEnvelope(ProductOrder, order, recordLinks(String(order.id)));

/**
 * The command a crossing write answers, by its `Idempotency-Key` (ADR 0068).
 * Every crossing route is wrapped in `requireIdempotencyKey`, so a request
 * without one never gets here; the unit of work claims the same key, which
 * keeps the write exactly-once even when the edge's record is lost.
 */
const commandIdOf = (request: HttpServerRequest.HttpServerRequest) =>
  parseIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER]);

/** A crossing write is retried by its coordinator: one answer per key. */
const idempotent = (route: string) =>
  requireIdempotencyKey({ route, caller: 'crossing' });

const notFound = (orderId?: string) =>
  HttpServerResponse.json(
    {
      error: 'not found',
      code: 'notFound',
      entity: KEY,
      ...(orderId === undefined ? {} : { orderId }),
    },
    { status: 404 },
  );

const orderIdParam = Effect.map(
  HttpRouter.params,
  // Every route here is `/:id`, so the parameter is always there.
  params => params.id as string,
);

/** `POST /api/product-order` — the checkout saga's `write-order` step. */
const place = (_context: EntityRouteContext, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const order = yield* readEntityEnvelope(ProductOrder, yield* request.json);
    const placement = yield* placeOrder({
      order,
      commandId: commandIdOf(request),
      cancelWindowSeconds: yield* CancelWindowSeconds,
    });
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(
        ProductOrder,
        placement.order,
        links.record(placement.order.id),
      ),
      { status: placement._tag === 'placed' ? 201 : 200 },
    );
  }).pipe(
    Effect.catch(error =>
      error instanceof OrderRefused ||
      error instanceof EntifixBuildError ||
      (isFailure(error) && error.category === 'invalid')
        ? HttpServerResponse.json(
            {
              error: 'invalid request body',
              code: 'invalidBody',
              detail:
                error instanceof OrderRefused ? error.detail : error.message,
            },
            { status: 400 },
          )
        : routeFailure(error),
    ),
  );

/**
 * `DELETE /api/product-order/:id` — a **compensation**, not a customer-facing
 * cancel: it undoes a step that should not have happened.
 */
const compensate = () =>
  Effect.gen(function* () {
    const orderId = yield* orderIdParam;
    const store = yield* ProductOrderStoreTag;
    const removed = yield* store.remove(orderId);
    return yield* HttpServerResponse.json({
      id: orderId,
      outcome: removed ? 'deleted' : 'not-found',
    });
  }).pipe(Effect.catch(routeFailure));

const cancelAnswer = (result: CancelResult, orderId: string) => {
  switch (result._tag) {
    case 'notFound':
      return notFound();
    case 'notAuthorized':
      // One answer for every capability failure: saying which part was wrong
      // would teach a caller how to forge the rest.
      return HttpServerResponse.json(
        {
          error: 'the order cannot be cancelled from here',
          code: 'cancelNotAuthorized',
        },
        { status: 401 },
      );
    case 'refused':
      return HttpServerResponse.json(
        {
          error:
            result.code === PAYMENT_PENDING
              ? 'the payment is still being confirmed'
              : isMultiVendorRefusal(result.code)
                ? 'the order names another vendor'
                : 'the order cannot be cancelled',
          code: result.code,
          orderId,
        },
        { status: 409 },
      );
    case 'cancelled':
      return HttpServerResponse.json(envelopeOf(result.order));
    case 'failed':
      return routeFailure(
        `the cancellation coordinator answered ${String(result.status)}`,
      );
  }
};

/** Read an order back for a transition that did not move it. */
const answerWithOrder = (orderId: string) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(orderId);
    return order === undefined
      ? yield* notFound(orderId)
      : yield* HttpServerResponse.json(envelopeOf(order));
  });

/** `POST /:id/cancelling` — the cancellation saga's concurrency claim. */
const claimCancellation = Effect.gen(function* () {
  const orderId = yield* orderIdParam;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const store = yield* ProductOrderStoreTag;
  const claim = yield* store.claimCancellation(orderId, commandIdOf(request));
  if (claim._tag === 'claimed') {
    return yield* HttpServerResponse.json(envelopeOf(claim.order));
  }
  if (claim._tag === 'replayed') return yield* answerWithOrder(orderId);
  const order = yield* store.get(orderId);
  if (order === undefined) return yield* notFound(orderId);
  return yield* HttpServerResponse.json(
    {
      error: 'the order cannot be cancelled',
      code: ORDER_NOT_CANCELLABLE,
      detail: `an order in '${order.status}' cannot be cancelled`,
      orderId,
    },
    { status: 409 },
  );
}).pipe(Effect.catch(routeFailure));

/** `DELETE /:id/cancelling` — the claim's compensation, `200` either way. */
const releaseCancellation = Effect.gen(function* () {
  const orderId = yield* orderIdParam;
  const store = yield* ProductOrderStoreTag;
  const released = yield* store.releaseCancellation(orderId);
  return yield* HttpServerResponse.json({
    id: orderId,
    outcome: released ? 'released' : 'not-claimed',
  });
}).pipe(Effect.catch(routeFailure));

/** `POST /:id/cancelled` — the last step: close the record, announce it. */
const settleCancellation = Effect.gen(function* () {
  const orderId = yield* orderIdParam;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const store = yield* ProductOrderStoreTag;
  const settled = yield* store.settleCancellation(
    orderId,
    commandIdOf(request),
  );
  return settled === undefined
    ? yield* answerWithOrder(orderId)
    : yield* HttpServerResponse.json(envelopeOf(settled));
}).pipe(Effect.catch(routeFailure));

const nonceOf = (body: unknown) => {
  const nonce = (body as { cancelNonce?: unknown } | undefined)?.cancelNonce;
  return typeof nonce === 'string' ? nonce : undefined;
};

const crossed = requireCrossing('order-management:product-order:write');

/**
 * order-service's surface. The reads are the generic ones, narrowed to the
 * caller (ADR 0053): an operator reads every order, a vendor the orders that
 * carry their lines, a buyer their own, and anybody else an empty page.
 *
 * ⚠️ **Three credentials on one surface, and each route takes exactly one.**
 * The saga's steps take a crossing token; fulfil and cancellation take a
 * session and the verb's permission; a buyer's cancellation takes the nonce
 * from their receipt and no session at all.
 *
 * ⚠️ `/cancelling` and `/cancellation` are one letter apart and are not the
 * same thing: the first is the coordinator's claim, the second is what a
 * person reaches.
 */
export const productOrderRoutes = (compositions: MetadataCompositions) =>
  Layer.mergeAll(
  makeEntityRoutes.for<
    | ProductOrderStoreTag
    | IdempotencyStoreTag
    | CancelWindowSeconds
    | HttpServerRequest.HttpServerRequest
    | HttpRouter.RouteContext
  >()(ProductOrder, {
    verbs: ['list', 'get', 'create', 'delete'],
    guard: {
      read: { kind: 'permission' },
      write: { kind: 'crossing', organization: false },
    },
    narrowing: orderNarrowing,
    compositions,
    override: {
      create: (context, links) =>
        idempotent(`POST ${BASE}`)(place(context, links)),
      delete: () => idempotent(`DELETE ${BASE}/:id`)(compensate()),
    },
  }),
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      `${BASE}/:id/fulfil`,
      requirePermission(FULFIL_PRODUCT_ORDER)(principal =>
        Effect.gen(function* () {
          const orderId = yield* orderIdParam;
          const result = yield* fulfilOrder({
            orderId,
            scope: orderScopeFor(principal),
          });
          switch (result._tag) {
            case 'notFound':
              return yield* notFound();
            case 'notFulfillable':
              return yield* HttpServerResponse.json(
                {
                  error: 'the order cannot be fulfilled',
                  code: 'orderNotFulfillable',
                  detail: result.detail,
                },
                { status: 409 },
              );
            case 'fulfilled':
              return yield* HttpServerResponse.json(envelopeOf(result.order));
          }
        }).pipe(Effect.catch(routeFailure)),
      ),
    ),
    HttpRouter.route(
      'POST',
      `${BASE}/:id/cancellation`,
      requirePermission(CANCEL_PRODUCT_ORDER)(principal =>
        Effect.gen(function* () {
          const orderId = yield* orderIdParam;
          const result = yield* cancelOrderAsStaff({
            orderId,
            scope: orderScopeFor(principal),
          });
          return yield* cancelAnswer(result, orderId);
        }).pipe(Effect.catch(routeFailure)),
      ),
    ),
    HttpRouter.route(
      'POST',
      `${BASE}/:id/buyer-cancellation`,
      Effect.gen(function* () {
        const orderId = yield* orderIdParam;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* request.json.pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );
        const result = yield* cancelOrderAsBuyer({
          orderId,
          nonce: nonceOf(body),
        });
        return yield* cancelAnswer(result, orderId);
      }).pipe(Effect.catch(routeFailure)),
    ),
    HttpRouter.route(
      'POST',
      `${BASE}/:id/cancelling`,
      crossed(idempotent(`POST ${BASE}/:id/cancelling`)(claimCancellation)),
    ),
    HttpRouter.route(
      'DELETE',
      `${BASE}/:id/cancelling`,
      crossed(idempotent(`DELETE ${BASE}/:id/cancelling`)(releaseCancellation)),
    ),
    HttpRouter.route(
      'POST',
      `${BASE}/:id/cancelled`,
      crossed(idempotent(`POST ${BASE}/:id/cancelled`)(settleCancellation)),
    ),
  ]),
);
