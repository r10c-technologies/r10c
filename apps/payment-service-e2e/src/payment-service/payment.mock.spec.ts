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
