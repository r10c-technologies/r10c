import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
} from '@entifix/business';
import {
  entityKey,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  capturePayment,
  NothingToRefund,
  Payment,
  PaymentDeclined,
  Refund,
  RefundDeclined,
  refundPayment,
} from '@r10c/business-ts-payment-management';
import { Effect, Option, Schema } from 'effect';

/** The `Idempotency-Key` a pivot is claimed on, in the ledger's unit of work. */
const commandId = Effect.map(
  Effect.serviceOption(IdempotencyKeyTag),
  Option.getOrUndefined,
);

/**
 * `POST /api/payment` — the checkout saga's pivot, behind a crossing token and
 * **no session**: the buyer behind a checkout holds no grant over the capture
 * made on their behalf. A declined capture is `paymentDeclined` with the
 * provider's reason, and a redelivery answers that refusal again rather than
 * success — telling the coordinator a declined capture succeeded would roll a
 * flow forward past a payment that never happened. The reads are behind the
 * read grant.
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
        errors: [InvalidBody, PaymentDeclined],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const payment = yield* readEntityEnvelope(Payment, request.payload);
            const { payment: decided } = yield* capturePayment({
              payment,
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
 * `POST /api/refund` — the cancellation saga's pivot, addressed by **order**:
 * the flow holds an order and has never seen a payment, and the amount is the
 * capture's, so a body cannot ask for more than was charged. A declined
 * refund is still written, and answered `refundDeclined`.
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
      payload: Schema.Struct({ orderId: Schema.NonEmptyString }),
      errors: [NothingToRefund, RefundDeclined],
      handler: (request: EntityApiRequest, context: EntityApiContext) =>
        Effect.gen(function* () {
          const { orderId } = request.payload as { readonly orderId: string };
          const { refund } = yield* refundPayment({
            orderId,
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
