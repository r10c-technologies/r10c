import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import {
  COMMAND_ID_HEADER,
  CROSSING_TOKEN_HEADER,
  ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  Payment,
  type PaymentLedger,
  PaymentLedgerTag,
  type PaymentProvider,
  PaymentProviderTag,
  Refund,
} from '@r10c/business-ts-payment-management';
import { type ServedRoutes,serveRoutes } from '@r10c/testing-http';
import { Effect, Layer, Option } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { paymentRoutes } from './payment-routes.js';

const decided = new Map<string, Payment | Refund>();
const payments: Payment[] = [];
const refunds: Refund[] = [];
let storeDown = false;

const ledger: PaymentLedger = {
  decidedPayment: commandId =>
    Effect.succeed(
      Option.fromUndefinedOr(decided.get(commandId) as Payment | undefined),
    ),
  decidedRefund: commandId =>
    Effect.succeed(
      Option.fromUndefinedOr(decided.get(commandId) as Refund | undefined),
    ),
  captureFor: orderId =>
    storeDown
      ? Effect.fail(new EntifixConnError('store down'))
      : Effect.succeed(
          payments.find(p => p.orderId === orderId && p.status === 'captured'),
        ),
  refundFor: paymentId =>
    Effect.succeed(refunds.find(r => r.paymentId === paymentId)),
  recordCapture: (payment, _outcome, commandId) =>
    Effect.sync(() => {
      payments.push(payment);
      if (commandId) decided.set(commandId, payment);
      return { _tag: 'recorded' as const, record: payment };
    }),
  recordRefund: (refund, _outcome, commandId) =>
    Effect.sync(() => {
      refunds.push(refund);
      if (commandId) decided.set(commandId, refund);
      return { _tag: 'recorded' as const, record: refund };
    }),
};

/** Declines whatever is for the order named `declined`. */
const provider: PaymentProvider = {
  authorize: () => Effect.die('unused'),
  capture: request =>
    Effect.succeed(
      request.orderId === 'declined'
        ? { status: 'failed' as const }
        : { status: 'captured' as const, providerReference: 'ref' },
    ),
  refund: request =>
    Effect.succeed(
      request.orderId === 'declined-refund'
        ? { status: 'failed' as const }
        : { status: 'refunded' as const },
    ),
};

const claims: TokenClaims = {
  userId: 'u-1',
  subject: 'ada',
  sessionId: 's-1',
  roles: ['admin'],
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    paymentRoutes,
    Layer.mergeAll(
      Layer.succeed(PaymentLedgerTag, ledger),
      Layer.succeed(PaymentProviderTag, provider),
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(makeInMemoryEntityRepository()),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          token === 'admin'
            ? Effect.succeed(claims)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          admin: ['payment-management:payment:read'],
        }),
      ),
      Layer.succeed(ServiceCrossingTokenTag, 'fleet'),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'payment-management:payment:write',
          'payment-management:refund:write',
        ]),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const crossing = (path: string, body: unknown, commandId?: string) =>
  served.call(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: 'fleet',
      ...(commandId ? { [COMMAND_ID_HEADER]: commandId } : {}),
    },
    body: JSON.stringify(body),
  });

const paymentBody = (orderId: string, amount = 40) => ({
  meta: { type: 'entity', entity: 'payment' },
  data: { orderId, amount, currency: 'GTQ', paymentMethod: 'card' },
});

describe('POST /api/payment', () => {
  it('captures, and answers a redelivery with the same decision', async () => {
    const first = await crossing('/api/payment', paymentBody('o-1'), 'c-1');
    const again = await crossing('/api/payment', paymentBody('o-1'), 'c-1');

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(payments).toHaveLength(1);
  });

  it('answers a declined capture, and its replay, with 402', async () => {
    const declined = await crossing(
      '/api/payment',
      paymentBody('declined'),
      'c-2',
    );
    const replayed = await crossing(
      '/api/payment',
      paymentBody('declined'),
      'c-2',
    );

    expect(declined.status).toBe(402);
    expect(await declined.json()).toMatchObject({ code: 'paymentDeclined' });
    expect(replayed.status).toBe(402);
  });

  it('refuses a payment for nothing, a body that is not an envelope, and a session', async () => {
    const nothing = await crossing('/api/payment', paymentBody('o-3', 0));
    const invalid = await crossing('/api/payment', { not: 'an envelope' });
    const session = await served.call('/api/payment', {
      method: 'POST',
      headers: { authorization: 'Bearer admin' },
      body: JSON.stringify(paymentBody('o-4')),
    });

    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toMatchObject({ code: 'invalidBody' });
    expect(invalid.status).toBe(400);
    expect(session.status).toBe(401);
  });

  it('serves the reads behind a session', async () => {
    const list = await served.call('/api/payment', {
      headers: { authorization: 'Bearer admin' },
    });

    expect(list.status).toBe(200);
  });
});

describe('POST /api/refund', () => {
  it('refunds an order’s capture, and answers a redelivery with the same refund', async () => {
    await crossing('/api/payment', paymentBody('o-10'));

    const first = await crossing('/api/refund', { orderId: 'o-10' }, 'r-1');
    const again = await crossing('/api/refund', { orderId: 'o-10' }, 'r-1');

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
  });

  it('answers a declined refund, and its replay, with 402', async () => {
    await crossing('/api/payment', paymentBody('declined-refund'));

    const declined = await crossing(
      '/api/refund',
      { orderId: 'declined-refund' },
      'r-2',
    );
    const replayed = await crossing(
      '/api/refund',
      { orderId: 'declined-refund' },
      'r-2',
    );

    expect(declined.status).toBe(402);
    expect(await declined.json()).toMatchObject({ code: 'refundDeclined' });
    expect(replayed.status).toBe(402);
  });

  it('answers an order nobody paid for with 404, and a body naming no order with 400', async () => {
    const unpaid = await crossing('/api/refund', { orderId: 'o-unpaid' });
    const nameless = await crossing('/api/refund', { orderId: '' });
    const notAnObject = await crossing('/api/refund', 'refund please');

    expect(unpaid.status).toBe(404);
    expect(await unpaid.json()).toMatchObject({ code: 'noCapturedPayment' });
    expect(nameless.status).toBe(400);
    expect(notAnObject.status).toBe(400);
  });

  it('answers a store that failed with 500', async () => {
    storeDown = true;
    try {
      const response = await crossing('/api/refund', { orderId: 'o-10' });

      expect(response.status).toBe(500);
    } finally {
      storeDown = false;
    }
  });
});
