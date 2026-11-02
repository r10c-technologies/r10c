import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
  verbEndpoint,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  type EntifixEnvelopeLink,
  entityKey,
  implement,
  Invalid,
  JsonBody,
  makeEntityEnvelope,
  NotFound,
  readEntityEnvelope,
} from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  CancelNotAuthorized,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  CancelProductOrderUC,
  CancelWindowSeconds,
  fulfilOrder,
  FulfilProductOrderUC,
  orderNarrowing,
  OrderNotCancellable,
  orderScopeFor,
  PaymentPending,
  placeOrder,
  ProductOrder,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { RefundDeclined } from '@r10c/business-ts-payment-contracts';
import { Effect, Option, Schema } from 'effect';

const KEY = entityKey(ProductOrder, 'product-order');
const BASE = `/api/${KEY}` as const;

/** The `Idempotency-Key` a crossing write is claimed on, in its unit of work. */
const commandId = Effect.map(
  Effect.serviceOption(IdempotencyKeyTag),
  Option.getOrUndefined,
);

const orderNotFound = new NotFound({ entity: KEY });

/** The record's own links: a participant's answer is read by a coordinator. */
const recordLinks = (orderId: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `${BASE}/${orderId}`, method: 'GET' },
  { rel: 'list', href: BASE, method: 'GET' },
];

const envelopeOf = (order: ProductOrder, links: EntifixEnvelopeLink[]) =>
  makeEntityEnvelope(ProductOrder, order, links);

/** An entity verb's answer: the order, with the links this caller may follow. */
const answerFor = (context: EntityApiContext) => (order: ProductOrder) =>
  envelopeOf(order, context.links.record(String(order.id)));

/** The id every entity verb is bound to; the path always carries it. */
const idOf = (request: EntityApiRequest) => request.params?.id as string;

/**
 * order-service's records. The reads are narrowed to the caller (ADR 0053): an
 * operator reads every order, a vendor the orders that carry their lines, a
 * buyer their own, and anybody else an empty page.
 *
 * ⚠️ **Three credentials on one surface, and each endpoint takes exactly one.**
 * Placing and compensating take a crossing token, because the buyer behind a
 * checkout holds no grant over the receipt written on their behalf; `fulfil`
 * and `cancel` take a session and the permission their own `@useCase()`
 * derives; a buyer's cancellation takes the nonce from their receipt.
 *
 * `DELETE` is a **compensation**, not a customer-facing cancel: it undoes a
 * step that should not have happened. A cancellation is a business event with
 * its own record and money consequences, and it is the `cancel` verb.
 */
export const productOrderApi = defineEntityApi(ProductOrder, KEY, {
  verbs: ['list', 'get', 'create', 'delete'],
  guard: {
    read: { kind: 'permission' },
    write: { kind: 'crossing', organization: false },
  },
  narrowing: orderNarrowing,
  override: {
    create: {
      idempotent: 'unit',
      errors: [InvalidBody, Invalid, DuplicateKey],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const order = yield* readEntityEnvelope(
            ProductOrder,
            request.payload,
          );
          const placement = yield* placeOrder({
            order,
            commandId: yield* commandId,
            cancelWindowSeconds: yield* CancelWindowSeconds,
          });
          return envelopeOf(
            placement.order,
            context.links.record(String(placement.order.id)),
          );
        }),
    },
    // Remembered at the edge: removing an order claims nothing in its write.
    delete: {
      idempotent: 'edge',
      handler: (request: EntityApiRequest) =>
        Effect.gen(function* () {
          const orderId = idOf(request);
          const store = yield* ProductOrderStoreTag;
          const removed = yield* store.remove(orderId);
          return { id: orderId, outcome: removed ? 'deleted' : 'not-found' };
        }),
    },
  },
  useCases: [
    verbEndpoint(FulfilProductOrderUC, {
      guard: { kind: 'permission' },
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        fulfilOrder({
          orderId: idOf(request),
          scope: orderScopeFor(context.principal ?? {}),
        }).pipe(Effect.map(answerFor(context))),
    }),
    verbEndpoint(CancelProductOrderUC, {
      guard: { kind: 'permission' },
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        cancelOrderAsStaff({
          orderId: idOf(request),
          scope: orderScopeFor(context.principal ?? {}),
        }).pipe(Effect.map(answerFor(context))),
    }),
  ],
});

const crossing = {
  kind: 'crossing',
  permission: 'order-management:product-order:write',
  organization: false,
} as const;

const params = { id: Schema.String };

/**
 * `POST /:id/buyer-cancellation` — a buyer cancelling with the capability
 * their receipt carried, and **no session at all**: the order stores the
 * nonce's digest, so the record is the authority. Every capability failure is
 * one `cancelNotAuthorized`, and a body that is not one is the same failure —
 * telling a caller which part was wrong would teach them how to forge the rest.
 */
const buyerCancellation = defineEndpoint({
  name: 'buyer-cancellation',
  method: 'POST',
  path: `${BASE}/:id/buyer-cancellation`,
  params,
  payload: JsonBody,
  success: JsonBody,
  errors: [
    CancelNotAuthorized,
    PaymentPending,
    OrderNotCancellable,
    RefundDeclined,
  ],
  guard: { kind: 'public' },
});

/**
 * `POST /:id/cancelling` — the cancellation saga's concurrency claim,
 * `paid → cancelling`.
 *
 * ⚠️ `/cancelling` and `/cancel` look alike and are not the same thing: this
 * one is dispatched by the coordinator behind a crossing guard; the other is
 * the verb a person reaches. A browser reaching this one would lock an order
 * with no refund behind it.
 */
const claimCancellation = defineEndpoint({
  name: 'claim-cancellation',
  method: 'POST',
  path: `${BASE}/:id/cancelling`,
  params,
  success: JsonBody,
  errors: [NotFound, OrderNotCancellable],
  guard: crossing,
  idempotent: 'unit',
});

/** `DELETE /:id/cancelling` — the claim's compensation, `200` either way. */
const releaseCancellation = defineEndpoint({
  name: 'release-cancellation',
  method: 'DELETE',
  path: `${BASE}/:id/cancelling`,
  params,
  success: Schema.Struct({
    id: Schema.String,
    outcome: Schema.Literals(['released', 'not-claimed']),
  }),
  errors: [],
  guard: crossing,
  idempotent: 'edge',
});

/** `POST /:id/cancelled` — the last step: close the record, announce it. */
const settleCancellation = defineEndpoint({
  name: 'settle-cancellation',
  method: 'POST',
  path: `${BASE}/:id/cancelled`,
  params,
  success: JsonBody,
  errors: [NotFound],
  guard: crossing,
  idempotent: 'unit',
});

const nonceOf = (body: unknown) => {
  const nonce = (body as { cancelNonce?: unknown } | undefined)?.cancelNonce;
  return typeof nonce === 'string' ? nonce : undefined;
};

/** Read an order back for a transition that did not move it. */
const answerWithOrder = (orderId: string) =>
  Effect.gen(function* () {
    const store = yield* ProductOrderStoreTag;
    const order = yield* store.get(orderId);
    if (order === undefined) return yield* orderNotFound;
    return envelopeOf(order, recordLinks(orderId));
  });

/**
 * The buyer's cancellation and the cancellation saga's three order steps.
 * `NotClaimable` never leaves the claim: a coordinator reads it as the order
 * having moved past cancelling, which is what it answers.
 */
export const productOrderEndpoints = [
  implement(buyerCancellation, ({ params: { id }, payload }) =>
    cancelOrderAsBuyer({ orderId: id, nonce: nonceOf(payload) }).pipe(
      Effect.map(order => envelopeOf(order, recordLinks(String(order.id)))),
    ),
  ),
  implement(claimCancellation, ({ params: { id } }) =>
    Effect.gen(function* () {
      const store = yield* ProductOrderStoreTag;
      const claim = yield* store.claimCancellation(id, yield* commandId);
      if (claim._tag === 'claimed') {
        return envelopeOf(claim.order, recordLinks(id));
      }
      if (claim._tag === 'replayed') return yield* answerWithOrder(id);
      const order = yield* store.get(id);
      if (order === undefined) return yield* orderNotFound;
      return yield* new OrderNotCancellable({
        orderId: id,
        reason: `an order in '${order.status}' cannot be cancelled`,
      });
    }),
  ),
  implement(releaseCancellation, ({ params: { id } }) =>
    Effect.gen(function* () {
      const store = yield* ProductOrderStoreTag;
      const released = yield* store.releaseCancellation(id);
      return {
        id,
        outcome: released ? ('released' as const) : ('not-claimed' as const),
      };
    }),
  ),
  implement(settleCancellation, ({ params: { id } }) =>
    Effect.gen(function* () {
      const store = yield* ProductOrderStoreTag;
      const settled = yield* store.settleCancellation(id, yield* commandId);
      return settled === undefined
        ? yield* answerWithOrder(id)
        : envelopeOf(settled, recordLinks(id));
    }),
  ),
] as const;
