import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  entityKey,
  implement,
  JsonBody,
  makeEntityEnvelope,
  Overloaded,
  UpstreamUnavailable,
} from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { RefundDeclined } from '@r10c/business-ts-payment-contracts';
import {
  capturePayment,
  checkCodEligibility,
  CodNotEntitled,
  CodOverLimit,
  NothingToRefund,
  Payment,
  PaymentAllocation,
  PaymentDeclined,
  PaymentMethods,
  recordCollection,
  Refund,
  RefundExceedsCapture,
  refundPayment,
} from '@r10c/business-ts-payment-management';
import { Effect, Option, Schema } from 'effect';

/** The `Idempotency-Key` a pivot is claimed on, in the ledger's unit of work. */
const commandId = Effect.map(
  Effect.serviceOption(IdempotencyKeyTag),
  Option.getOrUndefined,
);

/** One card vendor's share of a capture, by the vendor it is owed to. */
const Share = Schema.Struct({
  vendorId: Schema.NonEmptyString,
  amount: Schema.Number,
});

/**
 * What a capture is asked for: one charge for a group, as each card vendor's
 * share, and the order each vendor's segment wrote — by vendor, as a flow step
 * outside every segment is given them. The charge is the shares' sum, so the
 * total and its split can never disagree.
 */
const CaptureRequest = Schema.Struct({
  groupId: Schema.NonEmptyString,
  currency: Schema.NonEmptyString,
  paymentMethod: Schema.optional(Schema.Literals(PaymentMethods)),
  channelId: Schema.optional(Schema.String),
  shares: Schema.NonEmptyArray(Share),
  orderId: Schema.Record(Schema.String, Schema.String),
});
type CaptureRequest = typeof CaptureRequest.Type;

/** Each share allocated to the order its vendor wrote; a vendor with none is refused. */
const allocationsOf = (body: CaptureRequest) =>
  Effect.forEach(body.shares, share => {
    const orderId = body.orderId[share.vendorId];
    return orderId === undefined
      ? Effect.fail(
          new InvalidBody({
            reason: `a capture names no order for vendor '${share.vendorId}'`,
          }),
        )
      : Effect.succeed({ ...share, orderId });
  });

/**
 * `POST /api/payment` — checkout's pivot, behind a crossing token and **no
 * session**: the buyer behind a checkout holds no grant over the capture made
 * on their behalf. One charge for the checkout group, allocated per vendor
 * order. A declined capture is `paymentDeclined` with the provider's reason,
 * and a redelivery answers that refusal again rather than success. The reads
 * are behind the read grant.
 */
export const paymentApi = defineEntityApi(
  Payment,
  entityKey(Payment, 'payment'),
  {
    verbs: ['list', 'get', 'create'],
    guard: {
      read: { kind: 'permission' },
      write: { kind: 'crossing', organization: false },
    },
    override: {
      create: {
        idempotent: 'unit',
        payload: CaptureRequest,
        errors: [InvalidBody, PaymentDeclined, DuplicateKey],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const body = request.payload as CaptureRequest;
            const shares = yield* allocationsOf(body);
            const amount = shares.reduce((sum, share) => sum + share.amount, 0);
            const payment = Object.assign(
              new Payment(body.groupId, amount, body.currency),
              {
                paymentMethod: body.paymentMethod ?? 'card',
                channelId: body.channelId,
              },
            );
            const { payment: decided } = yield* capturePayment({
              payment,
              shares,
              commandId: yield* commandId,
            });
            return makeEntityEnvelope(
              Payment,
              decided,
              context.links.record(decided.id),
            );
          }),
      },
    },
  },
);

/**
 * `POST /api/refund` — the cancellation's pivot, addressed by **order**: the
 * flow holds an order and has never seen a payment. Without an `amount` it
 * gives back all that is left of the order's share; with one, that part of it,
 * and never more than is left. A declined refund is still written, and
 * answered `refundDeclined`.
 */
export const refundApi = defineEntityApi(Refund, entityKey(Refund, 'refund'), {
  verbs: ['list', 'get', 'create'],
  guard: {
    read: { kind: 'permission' },
    write: { kind: 'crossing', organization: false },
  },
  override: {
    create: {
      idempotent: 'unit',
      payload: Schema.Struct({
        orderId: Schema.NonEmptyString,
        amount: Schema.optional(Schema.Number),
      }),
      errors: [NothingToRefund, RefundDeclined, RefundExceedsCapture],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const { orderId, amount } = request.payload as {
            readonly orderId: string;
            readonly amount?: number;
          };
          const { refund } = yield* refundPayment({
            orderId,
            amount,
            commandId: yield* commandId,
          });
          return makeEntityEnvelope(
            Refund,
            refund,
            context.links.record(refund.id),
          );
        }),
    },
  },
});

/**
 * `GET /api/payment-allocation[/:id]` — each vendor order's share of a
 * payment: what was taken for it and what has gone back. Reconciliation's
 * view, behind the read grant the operator holds.
 */
export const paymentAllocationApi = defineEntityApi(
  PaymentAllocation,
  entityKey(PaymentAllocation, 'payment-allocation'),
  {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
  },
);

/**
 * `POST /api/collection` — the cash a courier collected for one
 * cash-on-delivery order, recorded after the delivery: a `cod` payment for that
 * order alone, announced as `payment.captured`. Idempotent in the unit, so a
 * courier's report delivered twice is one collection.
 */
const collection = defineEndpoint({
  name: 'collection',
  method: 'POST',
  path: '/api/collection',
  payload: Schema.Struct({
    groupId: Schema.NonEmptyString,
    orderId: Schema.NonEmptyString,
    vendorId: Schema.NonEmptyString,
    amount: Schema.Number,
    currency: Schema.NonEmptyString,
  }),
  success: JsonBody,
  errors: [InvalidBody, DuplicateKey],
  guard: {
    kind: 'crossing',
    permission: 'payment-management:collection:write',
    organization: false,
  },
  idempotent: 'unit',
});

/**
 * `POST /api/cod-eligibility` — may this seller's order be paid cash on
 * delivery? A read the checkout makes before its commit point, behind a
 * crossing token because the buyer asking holds no grant over a vendor's terms.
 */
const codEligibility = defineEndpoint({
  name: 'cod-eligibility',
  method: 'POST',
  path: '/api/cod-eligibility',
  payload: Schema.Struct({
    vendorId: Schema.NonEmptyString,
    amount: Schema.Number,
  }),
  success: Schema.Struct({
    vendorId: Schema.String,
    eligible: Schema.Literal(true),
  }),
  errors: [CodOverLimit, CodNotEntitled, UpstreamUnavailable, Overloaded],
  guard: {
    kind: 'crossing',
    permission: 'payment-management:cod-eligibility:read',
    organization: false,
  },
});

/** The two cash-on-delivery routes. */
export const codEndpoints = [
  implement(collection, ({ payload }) =>
    Effect.gen(function* () {
      const { payment } = yield* recordCollection({
        groupId: payload.groupId,
        share: {
          orderId: payload.orderId,
          vendorId: payload.vendorId,
          amount: payload.amount,
        },
        currency: payload.currency,
        commandId: yield* commandId,
      });
      return makeEntityEnvelope(Payment, payment, [
        {
          rel: 'self',
          href: `/api/payment/${String(payment.id)}`,
          method: 'GET',
        },
      ]);
    }),
  ),
  implement(codEligibility, ({ payload }) => checkCodEligibility(payload)),
] as const;
