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
  makeEnvelope,
  NotFound,
  openStruct,
  StaleRevision,
  Unavailable,
} from '@entifix/core';
import { InvalidBody, readStepRecord } from '@r10c/business-ts-common';
import {
  type FlowAccepted,
  FlowNotStarted,
} from '@r10c/business-ts-flow-contracts';
import {
  awaitPayment,
  buyerReceipt,
  CancelNotAuthorized,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  CancelProductOrderUC,
  CancelWindowSeconds,
  CheckoutGroup,
  checkoutGroupNarrowing,
  CheckoutGroupStoreTag,
  confirmPayment,
  ConfirmPaymentUC,
  moveOrder,
  openGroup,
  type OrderGuide,
  orderNarrowing,
  OrderNotCancellable,
  OrderNotTransitionable,
  orderScopeFor,
  type PaymentConfirmationPayload,
  type PaymentLinkPayload,
  PaymentLinkProvidersTag,
  PaymentPending,
  placeOrder,
  ProductOrder,
  ProductOrderStoreTag,
  ReceiptDays,
  redeemAccess,
  sendAccessLink,
  SendAccessLinkUC,
  sendReceiptMail,
  setPaymentLink,
  SetPaymentLinkUC,
} from '@r10c/business-ts-order-management';
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

/** A started cancellation's answer: the flow to follow (ADR 0073). */
const acceptedEnvelope = (accepted: FlowAccepted) =>
  makeEnvelope('flowAccepted', KEY, accepted);

/** The id every entity verb is bound to; the path always carries it. */
const idOf = (request: EntityApiRequest) => request.params?.id as string;

/** A string member of a body, or `undefined` for anything else. */
const stringOf = (body: unknown, member: string) => {
  const value = (body as Record<string, unknown> | undefined)?.[member];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Who a staff verb was performed by: the party behind the session, or its
 * user id for an account with no party record.
 */
const actorOf = (context: EntityApiContext) => {
  const principal = principalOf(context);
  return principal.partyId ?? String(principal.userId);
};

/** A verb's permission guard admits nobody without a verified principal. */
const principalOf = (context: EntityApiContext) =>
  context.principal as NonNullable<EntityApiContext['principal']>;

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
      errors: [InvalidBody, Invalid, DuplicateKey, StaleRevision, NotFound],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const order = yield* readStepRecord(ProductOrder, request.payload);
          const placement = yield* placeOrder({
            order,
            rawLines: rawLinesOf(request.payload),
            commandId: yield* commandId,
          });
          // The flow binds two keys from this answer, and a step providing
          // more than one is answered each by its own name: the shipment the
          // flow opens next quotes the number (ADR 0076 §3).
          return {
            ...envelopeOf(
              placement.order,
              context.links.record(String(placement.order.id)),
            ),
            orderId: String(placement.order.id),
            orderNumber: placement.order.number,
          };
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
    // Answered `202` with the cancellation to follow, never its outcome.
    verbEndpoint(CancelProductOrderUC, {
      guard: { kind: 'permission' },
      accepted: true,
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        cancelOrderAsStaff({
          orderId: idOf(request),
          scope: orderScopeFor(context.principal ?? {}),
        }).pipe(Effect.map(acceptedEnvelope)),
    }),
    // A payment-link order's two staff verbs (ADR 0081 §4, §10). Each is one
    // conditional write on `awaiting-payment`, answered with the order as it
    // moved: the decision is made at that write, and the checkout waiting on
    // a confirmation carries on by the event it announces.
    //
    // Remembered at the edge by `Idempotency-Key`: a seller's retried
    // confirmation is answered with the first one's order, `paid`, rather than
    // refused as no longer awaiting payment (#667).
    verbEndpoint(ConfirmPaymentUC, {
      guard: { kind: 'permission' },
      idempotent: 'edge',
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        confirmPayment({
          orderId: idOf(request),
          scope: orderScopeFor(principalOf(context)),
          payload: request.payload as PaymentConfirmationPayload,
          confirmedBy: actorOf(context),
        }).pipe(
          Effect.map(order =>
            envelopeOf(order, context.links.record(idOf(request))),
          ),
        ),
    }),
    verbEndpoint(SetPaymentLinkUC, {
      guard: { kind: 'permission' },
      idempotent: 'edge',
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        setPaymentLink({
          orderId: idOf(request),
          scope: orderScopeFor(principalOf(context)),
          payload: request.payload as PaymentLinkPayload,
          setBy: actorOf(context),
        }).pipe(
          Effect.map(order =>
            envelopeOf(order, context.links.record(idOf(request))),
          ),
        ),
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
      errors: [InvalidBody, Invalid, DuplicateKey, StaleRevision],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          // The contact travels nested, as the buyer gave it; the group
          // stores it as one checked row, so it is read apart.
          const { contact, ...members } = request.payload as Record<
            string,
            unknown
          >;
          const group = yield* readStepRecord(CheckoutGroup, members);
          const opening = yield* openGroup({
            group,
            contact,
            commandId: yield* commandId,
            cancelWindowSeconds: yield* CancelWindowSeconds,
            receiptDays: yield* ReceiptDays,
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
  useCases: [
    // "Find my order" (ADR 0076 §6): reached only through the storefront,
    // whose own crossing token alone opens it — never a session, never the
    // coordinator's token. Always `202`, the same body whatever matched.
    verbEndpoint(SendAccessLinkUC, {
      guard: { kind: 'crossing', organization: false, caller: 'storefront' },
      accepted: true,
      handler: (request: EntityApiRequest) =>
        sendAccessLink({
          number: stringOf(request.payload, 'number'),
          email: stringOf(request.payload, 'email'),
        }),
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
    FlowNotStarted,
  ],
  guard: { kind: 'public' },
  accepted: true,
});

/**
 * `GET /api/payment-link-provider` — the providers a seller may name when
 * setting a link: the configured dictionary, public facts only (ADR 0081
 * §10). Read by whoever may read orders, which is whoever sets a link.
 */
const paymentLinkProviders = defineEndpoint({
  name: 'payment-link-providers',
  method: 'GET',
  path: '/api/payment-link-provider',
  success: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        name: Schema.String,
        hosts: Schema.Array(Schema.String),
      }),
    ),
  }),
  errors: [],
  guard: {
    kind: 'permission',
    permission: 'order-management:product-order:read',
  },
});

/** The body of an order withdrawn while it waited for a payment link. */
const withdrawnEnvelope = (order: ProductOrder) => envelopeOf(order, []);

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
 * `POST /api/checkout-group/access` — redeem a mailed one-time access link
 * (ADR 0076 §6). The body carries the link's token and the digest of the
 * nonce the storefront just minted; one conditional write swaps that digest
 * in for the group's capability and spends the link. **The token and no
 * session**, as `buyer-cancellation` takes the nonce: answers the group's id,
 * which the storefront then reads the receipt back from with its new nonce.
 */
const accessRedemption = defineEndpoint({
  name: 'access-redemption',
  method: 'POST',
  path: `${GROUP_BASE}/access`,
  payload: JsonBody,
  success: Schema.Struct({ id: Schema.String }),
  errors: [CancelNotAuthorized],
  guard: { kind: 'public' },
});

/**
 * `POST /api/checkout-group/:id/receipt-mail` — the checkout's last step
 * (`order.notify-buyer`): mail the buyer their receipt with a fresh one-time
 * access link (ADR 0076 §6). A crossing, on its own narrow permission;
 * remembered at the edge, so a redelivery of one command does not mail twice,
 * while a retry after a failed send — a new command — draws a new link.
 *
 * ⚠️ Its answer is a step outcome and lands in the journal: it carries no
 * token.
 */
const receiptMail = defineEndpoint({
  name: 'receipt-mail',
  method: 'POST',
  path: `${GROUP_BASE}/:id/receipt-mail`,
  params,
  success: Schema.Struct({
    id: Schema.String,
    outcome: Schema.Literals(['sent', 'no-contact']),
  }),
  errors: [NotFound, Unavailable],
  guard: {
    kind: 'crossing',
    permission: 'order-management:checkout-group:send-receipt',
    organization: false,
  },
  idempotent: 'edge',
});

/**
 * The group as its buyer reads it back: everything but the access link's
 * members, which say when a link went out and which digest opens it — the
 * receipt has no use for either, so it never carries them.
 */
const receiptGroup = (group: CheckoutGroup) => {
  const envelope = makeEntityEnvelope(CheckoutGroup, group, []);
  const {
    accessDigest: _digest,
    accessExpiresAt: _expires,
    accessSentAt: _sent,
    ...data
  } = envelope.data as Record<string, unknown>;
  return { ...envelope, data };
};

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

/**
 * `POST /:id/awaiting-payment {paymentWindowMs}` — a payment-link order's
 * commit point: `pending → awaiting-payment`, stamped to stop waiting at the
 * window the coordinator states (ADR 0081 §3).
 */
const awaitingPayment = defineEndpoint({
  name: 'awaiting-payment',
  method: 'POST',
  path: `${BASE}/:id/awaiting-payment`,
  params,
  payload: JsonBody,
  success: JsonBody,
  errors: [...MOVE_ERRORS, InvalidBody],
  guard: crossing,
  idempotent: 'unit',
});

/**
 * `POST /:id/dispatched` — the shipment left with a courier, with the guide it
 * left with; a counter sale hands the goods over and names none
 * (ADR 0081 §11).
 */
const dispatched = defineEndpoint({
  name: 'dispatched',
  method: 'POST',
  path: `${BASE}/:id/dispatched`,
  params,
  payload: Schema.optional(
    openStruct({
      courierName: Schema.optional(Schema.String),
      trackingNumber: Schema.optional(Schema.String),
      trackingUrl: Schema.optional(Schema.String),
    }),
  ),
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

/**
 * The guide a dispatch step carried, or none: a counter sale's hand-over, or
 * a body that names no tracking number.
 */
const guideOf = (
  payload:
    | {
        readonly courierName?: string | undefined;
        readonly trackingNumber?: string | undefined;
        readonly trackingUrl?: string | undefined;
      }
    | undefined,
): OrderGuide | undefined =>
  payload?.trackingNumber === undefined || payload.trackingNumber === ''
    ? undefined
    : {
        courierName: payload.courierName ?? '',
        trackingNumber: payload.trackingNumber,
        trackingUrl: payload.trackingUrl ?? '',
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
  guide?: OrderGuide,
) =>
  Effect.gen(function* () {
    const order = yield* moveOrder({
      orderId,
      transition,
      commandId: yield* commandId,
      ...(guide === undefined ? {} : { guide }),
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
    cancelOrderAsBuyer({
      orderId: id,
      nonce: stringOf(payload, 'cancelNonce'),
      capabilityDigest: stringOf(payload, 'capabilityDigest'),
    }).pipe(
      // A cancellation started is a flow to follow; an order that only waited
      // for its payment link is withdrawn on the spot (ADR 0081 §4).
      Effect.map(answer =>
        answer._tag === 'withdrawn'
          ? withdrawnEnvelope(answer.order)
          : acceptedEnvelope(answer.accepted),
      ),
    ),
  ),
  implement(buyerReceiptRead, ({ params: { id }, headers }) =>
    buyerReceipt({ groupId: id, nonce: headers['x-cancel-nonce'] }).pipe(
      Effect.map(({ group, orders }) => ({
        group: receiptGroup(group),
        orders: orders.map(order => envelopeOf(order, [])),
      })),
    ),
  ),
  implement(accessRedemption, ({ payload }) =>
    redeemAccess({
      token: stringOf(payload, 'token'),
      capabilityDigest: stringOf(payload, 'capabilityDigest'),
    }),
  ),
  implement(receiptMail, ({ params: { id } }) =>
    sendReceiptMail({ groupId: id }),
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
  implement(paymentLinkProviders, () =>
    Effect.map(PaymentLinkProvidersTag, providers => ({ items: providers })),
  ),
  implement(awaitingPayment, ({ params: { id }, payload }) =>
    Effect.gen(function* () {
      const order = yield* awaitPayment({
        orderId: id,
        paymentWindowMs: (payload as { paymentWindowMs?: unknown } | undefined)
          ?.paymentWindowMs,
        commandId: yield* commandId,
      });
      return envelopeOf(order, recordLinks(id));
    }),
  ),
  implement(dispatched, ({ params: { id }, payload }) =>
    answerMove(id, 'mark-dispatched', guideOf(payload)),
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
