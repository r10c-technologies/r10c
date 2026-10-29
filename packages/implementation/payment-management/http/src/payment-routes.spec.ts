import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  IdempotencyStoreTag,
  InvalidToken,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { Unavailable } from '@entifix/core';
import { ServiceCrossingTokenTag } from '@entifix/service-shell';
import {
  makeInMemoryEntityRepository,
  makeInMemoryIdempotencyStore,
} from '@entifix/testing-unit';
import {
  type PaymentLedger,
  PaymentLedgerTag,
  PaymentProviderTag,
} from '@r10c/business-ts-payment-management';
import {
  makeInMemoryPaymentLedger,
  makeScriptedPaymentProvider,
} from '@r10c/business-ts-payment-management/testing';
import { crossingCall } from '@r10c/testing-cells';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { paymentRoutes } from './payment-routes.js';

let storeDown = false;

/** The shared in-memory ledger, failing its capture lookup on demand. */
const real = makeInMemoryPaymentLedger();
const ledger: PaymentLedger = {
  ...real,
  captureFor: orderId =>
    storeDown ? Effect.fail(new Unavailable({})) : real.captureFor(orderId),
};

/** Declines the capture for the order named `declined`, and the refund for `declined-refund`. */
const provider = makeScriptedPaymentProvider(
  (request, step) =>
    (step === 'capture' && request.orderId === 'declined') ||
    (step === 'refund' && request.orderId.startsWith('declined-refund')),
);

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
            : Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          admin: ['payment-management:payment:read'],
        }),
      ),
      Layer.succeed(ServiceCrossingTokenTag, 'fleet'),
      Layer.succeed(IdempotencyStoreTag, edge),
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

const crossing = (path: string, body: unknown, idempotencyKey?: string) =>
  crossingCall(served, path, { body, idempotencyKey });

const paymentBody = (orderId: string, amount = 40) => ({
  meta: { type: 'entity', entity: 'payment' },
  data: { orderId, amount, currency: 'GTQ', paymentMethod: 'card' },
});

/**
 * The edge's `Idempotency-Key` records, on a clock a case can move past their
 * retention — the only way to reach the unit of work's own replay, which is
 * what still answers once the edge has forgotten a key.
 */
let edgeNow = 0;
const edge = makeInMemoryIdempotencyStore({
  retentionMs: 60_000,
  now: () => edgeNow,
});
const forgetAtTheEdge = () => {
  edgeNow += 60_001;
};

describe('POST /api/payment', () => {
  it('captures, and answers a redelivery with the same decision', async () => {
    const first = await crossing('/api/payment', paymentBody('o-1'), 'c-1');
    const again = await crossing('/api/payment', paymentBody('o-1'), 'c-1');

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    // The edge replays the first answer, marked (ADR 0068).
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await Effect.runPromise(real.captureFor('o-1'))).toMatchObject({
      orderId: 'o-1',
    });
  });

  it('answers from the ledger once the edge has forgotten the key', async () => {
    const first = await crossing(
      '/api/payment',
      paymentBody('o-forgot'),
      'c-9',
    );
    const declined = await crossing(
      '/api/payment',
      paymentBody('declined'),
      'c-10',
    );
    forgetAtTheEdge();
    const again = await crossing(
      '/api/payment',
      paymentBody('o-forgot'),
      'c-9',
    );
    const declinedAgain = await crossing(
      '/api/payment',
      paymentBody('declined'),
      'c-10',
    );

    expect(first.status).toBe(201);
    expect(declined.status).toBe(402);
    // Not the edge's replay: the ledger's own claim on the same key.
    expect(again.status).toBe(200);
    expect(again.headers.get('idempotent-replayed')).toBeNull();
    expect(declinedAgain.status).toBe(402);
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
    expect(again.status).toBe(201);
  });

  it('answers a refund from the ledger once the edge has forgotten the key', async () => {
    await crossing('/api/payment', paymentBody('o-r-forgot'));
    await crossing('/api/payment', paymentBody('declined-refund-forgot'));
    const first = await crossing(
      '/api/refund',
      { orderId: 'o-r-forgot' },
      'r-9',
    );
    const declined = await crossing(
      '/api/refund',
      { orderId: 'declined-refund-forgot' },
      'r-10',
    );
    forgetAtTheEdge();
    const again = await crossing(
      '/api/refund',
      { orderId: 'o-r-forgot' },
      'r-9',
    );
    const declinedAgain = await crossing(
      '/api/refund',
      { orderId: 'declined-refund-forgot' },
      'r-10',
    );

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect([declined.status, declinedAgain.status]).toEqual([402, 402]);
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
