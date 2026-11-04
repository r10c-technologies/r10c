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
} from '@entifix/core';
import { InvalidBody, readStepRecord } from '@r10c/business-ts-common';
import {
  buyerReceipt,
  CancelNotAuthorized,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  CancelProductOrderUC,
  CancelWindowSeconds,
  CheckoutGroup,
  checkoutGroupNarrowing,
  CheckoutGroupStoreTag,
  moveOrder,
  openGroup,
  orderNarrowing,
  OrderNotCancellable,
  OrderNotTransitionable,
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
const GROUP_KEY = entityKey(CheckoutGroup, 'checkout-group');
const GROUP_BASE = `/api/${GROUP_KEY}` as const;

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

/** The lines a write carried, as sent — before a line's vendor is dropped. */
const rawLinesOf = (payload: unknown): readonly unknown[] => {
  const items = (payload as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items : [];
};

/**
 * order-service's vendor orders. The reads are narrowed to the caller (ADR
 * 0053): an operator reads every order, a vendor their own, a buyer theirs,
 * and anybody else an empty page.
 *
 * ⚠️ **Three credentials on one surface, and each endpoint takes exactly one.**
 * Placing and compensating take a crossing token, because the buyer behind a
 * checkout holds no grant over the receipt written on their behalf; `cancel`
 * takes a session and the permission its own `@useCase()` derives; a buyer's
 * cancellation takes the nonce from their receipt.
 *
 * `DELETE` is a **compensation**, not a customer-facing cancel: it undoes a
 * step that should not have happened.
 */
export const productOrderApi = defineEntityApi(ProductOrder, KEY, {
  verbs: ['list', 'get', 'create', 'delete'],
  guard: {
    read: { kind: 'permission' },
    write: { kind: 'crossing', organization: false },
  },
  narrowing: orderNarrowing,
  override: {
    // A flow step: the order's members, flat, beside the group the flow bound.
    create: {
      idempotent: 'unit',
      payload: JsonBody,
      errors: [InvalidBody, Invalid, DuplicateKey, NotFound],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const order = yield* readStepRecord(ProductOrder, request.payload);
          const placement = yield* placeOrder({
            order,
            rawLines: rawLinesOf(request.payload),
            commandId: yield* commandId,
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

/**
 * The buyer's checkout groups — the receipt across sellers. The reads are
 * narrowed: an operator reads every group, a buyer theirs, **a vendor none**.
 * Opening and its compensation take a crossing token; the group's id is the
 * checkout flow's, handed in by the flow (ADR 0069).
 */
export const checkoutGroupApi = defineEntityApi(CheckoutGroup, GROUP_KEY, {
  verbs: ['list', 'get', 'create', 'delete'],
  guard: {
    read: { kind: 'permission' },
    write: { kind: 'crossing', organization: false },
  },
  narrowing: checkoutGroupNarrowing,
  override: {
    // A flow step: the group's members, flat.
    create: {
      idempotent: 'unit',
      payload: JsonBody,
      errors: [InvalidBody, Invalid, DuplicateKey],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const group = yield* readStepRecord(CheckoutGroup, request.payload);
          const opening = yield* openGroup({
            group,
            commandId: yield* commandId,
            cancelWindowSeconds: yield* CancelWindowSeconds,
          });
          return makeEntityEnvelope(
            CheckoutGroup,
            opening.group,
            context.links.record(String(opening.group.id)),
          );
        }),
    },
    delete: {
      idempotent: 'edge',
      handler: (request: EntityApiRequest) =>
        Effect.gen(function* () {
          const groupId = idOf(request);
          const groups = yield* CheckoutGroupStoreTag;
          const removed = yield* groups.remove(groupId);
          return { id: groupId, outcome: removed ? 'deleted' : 'not-found' };
        }),
    },
  },
});

const crossing = {
  kind: 'crossing',
  permission: 'order-management:product-order:write',
  organization: false,
} as const;

const params = { id: Schema.String };

/**
 * `POST /:id/buyer-cancellation` — a buyer cancelling one vendor order with
 * the capability their receipt carried — the group's — and **no session at
 * all**: the group stores the nonce's digest, so the record is the authority.
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
 * `GET /api/checkout-group/:id/buyer-receipt` — the buyer's receipt read back
 * by the same capability, in the `x-cancel-nonce` header and never the query
 * string, with no session: the group and every vendor order in it. What a
 * storefront that waited on a flow reads once it completed, knowing only the
 * flow's id — the group's.
 */
const buyerReceiptRead = defineEndpoint({
  name: 'buyer-receipt',
  method: 'GET',
  path: `${GROUP_BASE}/:id/buyer-receipt`,
  params,
  headers: Schema.Record(Schema.String, Schema.String),
  success: JsonBody,
  errors: [CancelNotAuthorized],
  guard: { kind: 'public' },
});

/**
 * `POST /:id/cancelling` — the cancellation's concurrency claim,
 * `paid | confirmed → cancelling`.
 *
 * ⚠️ `/cancelling` and `/cancel` look alike and are not the same thing: this
 * one is dispatched by the coordinator behind a crossing guard; the other is
 * the verb a person reaches.
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

const MOVE_ERRORS = [NotFound, OrderNotTransitionable];

/** `POST /:id/confirmed` — the checkout committed: card paid, or COD agreed. */
const confirmed = defineEndpoint({
  name: 'confirmed',
  method: 'POST',
  path: `${BASE}/:id/confirmed`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing,
  idempotent: 'unit',
});

/** `POST /:id/dispatched` — the shipment left with a courier. */
const dispatched = defineEndpoint({
  name: 'dispatched',
  method: 'POST',
  path: `${BASE}/:id/dispatched`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing,
  idempotent: 'unit',
});

/**
 * `POST /:id/closed {outcome}` — the last step of whichever flow ends an
 * order: `fulfilled` on delivery; `cancelled` settles a cancellation's claim,
 * or closes a parcel refused or returned. Either cancelled close announces
 * `order.cancelled`.
 */
const closed = defineEndpoint({
  name: 'closed',
  method: 'POST',
  path: `${BASE}/:id/closed`,
  params,
  payload: Schema.Struct({
    outcome: Schema.Literals(['fulfilled', 'cancelled']),
  }),
  success: JsonBody,
  errors: MOVE_ERRORS,
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

/** One crossing move, answered with the order it moved. */
const answerMove = (
  orderId: string,
  transition:
    'confirm' | 'mark-dispatched' | 'close-fulfilled' | 'close-cancelled',
) =>
  Effect.gen(function* () {
    const order = yield* moveOrder({
      orderId,
      transition,
      commandId: yield* commandId,
    });
    return envelopeOf(order, recordLinks(orderId));
  });

/**
 * The buyer's cancellation and receipt, and the flows' crossing steps on an
 * order. `NotClaimable` never leaves the claim: a coordinator reads it as the
 * order having moved past cancelling, which is what it answers.
 */
export const productOrderEndpoints = [
  implement(buyerCancellation, ({ params: { id }, payload }) =>
    cancelOrderAsBuyer({ orderId: id, nonce: nonceOf(payload) }).pipe(
      Effect.map(order => envelopeOf(order, recordLinks(String(order.id)))),
    ),
  ),
  implement(buyerReceiptRead, ({ params: { id }, headers }) =>
    buyerReceipt({ groupId: id, nonce: headers['x-cancel-nonce'] }).pipe(
      Effect.map(({ group, orders }) => ({
        group: makeEntityEnvelope(CheckoutGroup, group, []),
        orders: orders.map(order => envelopeOf(order, [])),
      })),
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
  implement(confirmed, ({ params: { id } }) => answerMove(id, 'confirm')),
  implement(dispatched, ({ params: { id } }) =>
    answerMove(id, 'mark-dispatched'),
  ),
  implement(closed, ({ params: { id }, payload }) =>
    Effect.gen(function* () {
      if (payload.outcome === 'fulfilled') {
        return yield* answerMove(id, 'close-fulfilled');
      }
      // A claimed cancellation settles; a dispatched parcel closes cancelled.
      const store = yield* ProductOrderStoreTag;
      const order = yield* store.get(id);
      if (order === undefined) return yield* orderNotFound;
      if (order.status !== 'cancelling') {
        return yield* answerMove(id, 'close-cancelled');
      }
      const settled = yield* store.settleCancellation(id, yield* commandId);
      return settled === undefined
        ? yield* answerWithOrder(id)
        : envelopeOf(settled, recordLinks(id));
    }),
  ),
] as const;
