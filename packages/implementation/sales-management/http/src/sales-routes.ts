import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import { makeEnvelope } from '@entifix/core';
import {
  makeEntityRoutes,
  requireOrganization,
  routeFailure,
} from '@entifix/service-shell';
import {
  CounterSaleRefused,
  readCounterSale,
  SalesChannel,
  SELL_AT_CHANNEL,
  sellAtCounter,
  validateSalesChannel,
} from '@r10c/business-ts-sales-management';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link salesRoutes}, beyond the two flow ports. */
export type SalesRouteServices =
  EntityRepositoryFactoryTag | TokenServiceTag | PolicyDecisionTag;

const REFUSAL_STATUS: Record<CounterSaleRefused['code'], number> = {
  invalidBody: 400,
  notFound: 404,
  channelInactive: 409,
  notYours: 403,
};

const REFUSAL_ERROR: Record<CounterSaleRefused['code'], string> = {
  invalidBody: 'invalid request body',
  notFound: 'no such sales channel',
  channelInactive: 'that channel is retired',
  notYours: 'that offering belongs to another vendor',
};

const failed = (error: unknown) =>
  error instanceof CounterSaleRefused
    ? HttpServerResponse.json(
        {
          error: REFUSAL_ERROR[error.code],
          code: error.code,
          detail: error.detail,
        },
        { status: REFUSAL_STATUS[error.code] },
      )
    : routeFailure(error);

/**
 * `POST /api/counter-sale` — the till's one write, and it persists nothing
 * here. A **session and no token**, checked against `sales-channel:sell`;
 * only once the use case has decided the sale is the caller's to make does
 * this process present the coordinator's crossing token (ADR 0056).
 */
const counterSale = (organizationId: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const sale = readCounterSale(yield* request.json);
    if (sale === undefined) {
      return yield* Effect.fail(
        new CounterSaleRefused(
          'invalidBody',
          'a counter sale needs a channelId, a paymentMethod and at least one line of a positive whole quantity',
        ),
      );
    }
    const outcome = yield* sellAtCounter({ organizationId, sale });
    return yield* outcome._tag === 'sold'
      ? HttpServerResponse.json(
          makeEnvelope('sagaResult', 'counter-sale', outcome.result),
          { status: 201 },
        )
      : // A stock outcome the seller can act on, not an error: a line could
        // not be held and every hold taken was given back.
        HttpServerResponse.json(
          {
            error: 'the sale could not be completed',
            code: 'stockUnavailable',
            detail:
              'A line could not be held, and every hold taken was released',
          },
          { status: 409 },
        );
  }).pipe(Effect.catch(failed));

/**
 * sales-service's surface: a vendor's channels, authored by a member of the
 * organization that owns them — a session bound to that organization is the
 * only credential any route here accepts — and the counter sale.
 */
export const salesRoutes = Layer.mergeAll(
  makeEntityRoutes(SalesChannel, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: channel => {
      const invalid = validateSalesChannel(channel);
      return invalid === undefined
        ? Effect.succeed(channel)
        : Effect.fail(invalid);
    },
  }),
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      '/api/counter-sale',
      requireOrganization(SELL_AT_CHANNEL)(counterSale),
    ),
  ]),
);
