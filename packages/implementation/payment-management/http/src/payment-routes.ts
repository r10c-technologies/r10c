import type {
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@entifix/core';
import {
  COMMAND_ID_HEADER,
  type EntityRouteLinks,
  makeEntityRoutes,
  routeFailure,
  type ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import {
  capturePayment,
  Payment,
  type PaymentLedgerTag,
  type PaymentProviderTag,
  PaymentRefused,
  Refund,
  refundPayment,
} from '@r10c/business-ts-payment-management';
import { Effect, Layer } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link paymentRoutes}. */
export type PaymentRouteServices =
  | EntityRepositoryFactoryTag
  | PaymentLedgerTag
  | PaymentProviderTag
  | TokenServiceTag
  | PolicyDecisionTag
  | ServiceCrossingTokenTag
  | ServiceCrossingPolicyTag;

const commandIdOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers[COMMAND_ID_HEADER]?.trim() || undefined;

const refusal = (error: PaymentRefused) =>
  HttpServerResponse.json(
    {
      error:
        error.code === 'noCapturedPayment'
          ? 'no captured payment for this order'
          : 'invalid request body',
      code: error.code,
      detail: error.detail,
    },
    { status: error.code === 'noCapturedPayment' ? 404 : 400 },
  );

const failed = (error: unknown) =>
  error instanceof PaymentRefused
    ? refusal(error)
    : error instanceof EntifixBuildError
      ? HttpServerResponse.json(
          {
            error: 'invalid request body',
            code: 'invalidBody',
            detail: error.message,
          },
          { status: 400 },
        )
      : routeFailure(error);

/**
 * `POST /api/payment` — the checkout saga's pivot.
 *
 * ⚠️ **A replay answers what the first attempt decided, status and all**: a
 * declined capture replays as `402`, never as success, or the coordinator
 * would roll a saga forward past a payment that never happened.
 */
const capture = (_context: unknown, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const payment = yield* readEntityEnvelope(Payment, yield* request.json);
    const result = yield* capturePayment({
      payment,
      commandId: commandIdOf(request),
    });
    const envelope = makeEntityEnvelope(
      Payment,
      result.payment,
      links.record(result.payment.id),
    );
    switch (result._tag) {
      case 'captured':
        return yield* HttpServerResponse.json(envelope, { status: 201 });
      case 'replayed':
        return yield* HttpServerResponse.json(envelope, {
          status: result.payment.status === 'captured' ? 200 : 402,
        });
      case 'declined':
        return yield* HttpServerResponse.json(
          {
            error: 'the payment was not captured',
            code: 'paymentDeclined',
            // A refusal names its reason: the PaymentProvider contract says so.
            detail: result.reason,
            paymentId: String(result.payment.id),
          },
          { status: 402 },
        );
    }
  }).pipe(Effect.catch(failed));

const readOrderId = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const { orderId } = body as Record<string, unknown>;
  return typeof orderId === 'string' && orderId !== '' ? orderId : undefined;
};

/**
 * `POST /api/refund` — the cancellation saga's pivot, addressed by order.
 * A refusal answers `402` and the row is still written: the record that an
 * attempt happened is what support and reconciliation both need.
 */
const refund = (_context: unknown, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const orderId = readOrderId(yield* request.json);
    if (orderId === undefined) {
      return yield* Effect.fail(
        new PaymentRefused(
          'invalidBody',
          'a refund must name the order it is for',
        ),
      );
    }
    const result = yield* refundPayment({
      orderId,
      commandId: commandIdOf(request),
    });
    const envelope = makeEntityEnvelope(
      Refund,
      result.refund,
      links.record(result.refund.id),
    );
    switch (result._tag) {
      case 'refunded':
        return yield* HttpServerResponse.json(envelope, { status: 201 });
      case 'replayed':
        return yield* HttpServerResponse.json(envelope, {
          status: result.refund.status === 'refunded' ? 200 : 402,
        });
      case 'declined':
        return yield* HttpServerResponse.json(
          {
            error: 'the refund was not made',
            code: 'refundDeclined',
            detail: result.reason,
            refundId: String(result.refund.id),
          },
          { status: 402 },
        );
    }
  }).pipe(Effect.catch(failed));

/**
 * The payment-service surface: the generic reads for both records, behind a
 * session and the read grant, and the two pivots, behind a crossing token and
 * **no session** — the buyer behind a checkout holds no grant over the capture
 * made on their behalf, and a route that also took a session would make the
 * weaker credential the security level.
 */
export const paymentRoutes = Layer.mergeAll(
  makeEntityRoutes(Payment, {
    verbs: ['list', 'get', 'create'],
    guard: {
      read: { kind: 'permission' },
      write: { kind: 'crossing', organization: false },
    },
    override: { create: capture },
  }),
  makeEntityRoutes(Refund, {
    verbs: ['list', 'get', 'create'],
    guard: {
      read: { kind: 'permission' },
      write: { kind: 'crossing', organization: false },
    },
    override: { create: refund },
  }),
);
