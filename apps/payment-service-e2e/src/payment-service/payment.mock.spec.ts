import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, E2E_CROSSING_TOKEN } from '../support/tokens';

/**
 * Taking a payment, and reading one back.
 *
 * The two halves take **different credentials on purpose**, and every assertion
 * about that is here rather than in a comment: capturing is a saga step behind a
 * crossing token, reading is an ordinary authenticated read. What ADR 0023
 * forbids is a single *route* taking either.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'PAYMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const crossing = (extra: Record<string, string> = {}) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  // ⚠️ Deliberately no `Authorization`: this route takes no session, and axios
  // merges per-request headers over the client default.
  Authorization: undefined,
  ...extra,
});

const capture = (
  body: Record<string, unknown> = {},
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/payment',
    {
      meta: { type: 'entity', entity: 'payment' },
      data: {
        orderId: 'order-1',
        amount: 1999,
        currency: 'GTQ',
        paymentMethod: 'card',
        ...body,
      },
    },
    { headers: crossing(extra) },
  );

describe('capturing a payment', () => {
  it('writes it and answers 201', async () => {
    const res = await capture();

    expect(res.status).toBe(201);
    expect(res.data.data.status).toBe('captured');
    expect(typeof res.data.data.id).toBe('string');
  });

  /**
   * ⚠️ **Server-owned.** A body claiming `captured` before anyone was asked
   * would assert money nobody took; a body choosing the id could overwrite
   * another payment.
   */
  it('ignores a status and an id supplied by the caller', async () => {
    const res = await capture({ id: 'chosen', status: 'captured' });

    expect(res.status).toBe(201);
    expect(res.data.data.id).not.toBe('chosen');
    // Still `captured`, but because the provider said so — the reference proves
    // the adapter ran rather than the body being echoed back.
    expect(res.data.data.providerReference).toBe(
      `sim_${String(res.data.data.id)}`,
    );
  });

  it('refuses an amount that is not positive', async () => {
    const res = await capture({ amount: 0 });

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('refuses a body with no envelope', async () => {
    const res = await service.client.post(
      '/api/payment',
      { orderId: 'order-1', amount: 1 },
      { headers: crossing() },
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });
});

describe('the capture route takes one credential', () => {
  it('refuses a session, even an operator one', async () => {
    const res = await service.client.post(
      '/api/payment',
      {
        meta: { type: 'entity', entity: 'payment' },
        data: { orderId: 'order-1', amount: 1999, currency: 'GTQ' },
      },
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    // ⚠️ Not 403. Two accepted credentials on one route means the weaker one is
    // the security level, so a session is not a lesser caller here — it is the
    // wrong kind of caller entirely.
    expect(res.status).toBe(401);
  });

  it('refuses a wrong crossing token', async () => {
    const res = await capture({}, { 'x-crossing-token': 'not-the-token' });

    expect(res.status).toBe(401);
  });
});

describe('a redelivered command', () => {
  /**
   * ⚠️ **The assertion this whole service exists to make safe.** `runSaga`
   * re-dispatches a post-pivot step on a stable command id, and a capture that
   * ran twice is a customer charged twice.
   */
  it('answers the first decision rather than taking the money again', async () => {
    const commandId = `cmd-${String(Date.now())}`;

    const first = await capture({}, { 'x-command-id': commandId });
    const second = await capture({}, { 'x-command-id': commandId });

    expect(first.status).toBe(201);
    // `200`, not `409`: a coordinator that could not tell a duplicate from a
    // refusal would compensate a flow whose payment did in fact succeed.
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);
  });
});

describe('reading payments', () => {
  it('needs a session', async () => {
    const res = await service.client.get('/api/payment', {
      headers: { Authorization: undefined },
    });

    expect(res.status).toBe(401);
  });

  /**
   * ⚠️ **`user` deliberately holds no `payment:read`.** The read is not scoped
   * to the caller — a `Payment` carries no buyer and no vendor to key one on —
   * so granting it a tier lower would show every signed-in account every payment
   * on the platform. ADR 0054 records the residual; this is the assertion that
   * keeps it from being granted by accident.
   */
  it('refuses a plain user', async () => {
    const res = await service.client.get('/api/payment', {
      headers: { Authorization: await bearerFor(['user']) },
    });

    expect(res.status).toBe(403);
  });

  it('serves an admin a page', async () => {
    await capture();
    const res = await service.client.get('/api/payment');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.data.items)).toBe(true);
  });

  /**
   * ⚠️ Registered as a **literal** before `/:id`. As `/api/:entity/$metadata` it
   * is shadowed by the by-id route and silently never runs, which reads as "this
   * entity has no metadata" (ADR 0026).
   */
  it('serves $metadata rather than treating it as an id', async () => {
    const res = await service.client.get('/api/payment/$metadata');

    expect(res.status).toBe(200);
    // No role writes a payment, so the descriptor must not advertise one.
    expect(res.data.data.actions).toEqual(['read']);
  });

  it('answers 404 for a payment that is not there', async () => {
    const res = await service.client.get('/api/payment/missing');

    expect(res.status).toBe(404);
    expect(res.data.code).toBe('notFound');
  });
});

/**
 * Sending money back.
 *
 * The same credential split as a capture, for the same reason: refunding is the
 * cancellation saga's pivot, and the buyer behind a cancellation holds no grant
 * over the money movement made on their behalf.
 */
const refund = (
  body: Record<string, unknown> = {},
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/refund',
    { orderId: 'order-1', ...body },
    { headers: crossing(extra) },
  );

describe('refunding a payment', () => {
  it('writes its own record and leaves the capture alone', async () => {
    const orderId = `order-refund-${String(Date.now())}`;
    const captured = await capture({ orderId });
    const res = await refund({ orderId });

    expect(res.status).toBe(201);
    expect(res.data.meta.entity).toBe('refund');
    expect(res.data.data.status).toBe('refunded');
    // The record it reverses, resolved by the route rather than named by the
    // caller.
    expect(res.data.data.paymentId).toBe(captured.data.data.id);

    const after = await service.client.get(
      `/api/payment/${String(captured.data.data.id)}`,
    );
    // ⚠️ The assertion the whole design rests on: ADR 0054 protects the capture
    // row as the evidence a customer was charged, and money going back must not
    // erase it.
    expect(after.data.data.status).toBe('captured');
  });

  /**
   * ⚠️ The amount is copied off the resolved capture, never read from the
   * request. A body that can name its own amount can refund more than was ever
   * charged.
   */
  it('refunds what was captured, not what the caller says', async () => {
    const orderId = `order-amount-${String(Date.now())}`;
    await capture({ orderId, amount: 1999 });
    const res = await refund({ orderId, amount: 999_999 });

    expect(res.status).toBe(201);
    expect(res.data.data.amount).toBe(1999);
  });

  /**
   * Its own reference, not the capture's. A reconciliation joins on both, and
   * reusing one would make the two indistinguishable exactly where they have to
   * be told apart.
   */
  it('carries a provider reference of its own', async () => {
    const orderId = `order-reference-${String(Date.now())}`;
    const captured = await capture({ orderId });
    const res = await refund({ orderId });

    expect(res.data.data.providerReference).not.toBe(
      captured.data.data.providerReference,
    );
    expect(String(res.data.data.providerReference)).toContain('sim_refund_');
  });

  it('answers 404 for an order nobody paid for', async () => {
    const res = await refund({ orderId: `order-unpaid-${String(Date.now())}` });

    // A business refusal rather than a fault: the coordinator reads a 4xx as
    // "this step refused" and compensates the claim before it.
    expect(res.status).toBe(404);
    expect(res.data.code).toBe('noCapturedPayment');
  });

  it('refuses a request that names no order', async () => {
    const res = await service.client.post(
      '/api/refund',
      {},
      { headers: crossing() },
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('refuses a session, even super-admin', async () => {
    const orderId = `order-session-${String(Date.now())}`;
    await capture({ orderId });
    const res = await service.client.post(
      '/api/refund',
      { orderId },
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    // Not 403. Two accepted credentials on one route means the weaker one is
    // the security level.
    expect(res.status).toBe(401);
  });

  it('refuses a wrong crossing token', async () => {
    const res = await refund({}, { 'x-crossing-token': 'not-the-token' });

    expect(res.status).toBe(401);
  });

  /**
   * ⚠️ A redelivered command must answer the first decision rather than sending
   * the money a second time. The claim is in the same transaction as the write.
   */
  it('answers the first decision when the command is redelivered', async () => {
    const orderId = `order-replay-${String(Date.now())}`;
    await capture({ orderId });
    const commandId = `cmd-refund-${String(Date.now())}`;

    const first = await refund({ orderId }, { 'x-command-id': commandId });
    const second = await refund({ orderId }, { 'x-command-id': commandId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);
  });

  /**
   * ⚠️ The other half of the guard, and a different question: two *distinct*
   * commands aimed at one capture. The unique index on `paymentId` is what
   * refuses the second, and the pre-read is what keeps it from moving money at
   * the provider first.
   */
  it('refunds one capture once, however many commands ask', async () => {
    const orderId = `order-twice-${String(Date.now())}`;
    await capture({ orderId });

    const first = await refund({ orderId }, { 'x-command-id': 'cmd-a' });
    const second = await refund({ orderId }, { 'x-command-id': 'cmd-b' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);
  });
});

describe('reading refunds', () => {
  it('needs a session', async () => {
    const res = await service.client.get('/api/refund', {
      headers: { Authorization: undefined },
    });

    expect(res.status).toBe(401);
  });

  it('serves an admin a page', async () => {
    const res = await service.client.get('/api/refund');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.data.items)).toBe(true);
  });

  it('serves $metadata rather than treating it as an id', async () => {
    const res = await service.client.get('/api/refund/$metadata');

    expect(res.status).toBe(200);
    // No role writes a refund, so the descriptor must not advertise one.
    expect(res.data.data.actions).toEqual(['read']);
  });
});
