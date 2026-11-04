import { defineServiceE2e } from '@entifix/testing-e2e/service';

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
  // Every crossing write is idempotent on its key: a fresh one per call
  // unless a case names its own (ADR 0068).
  'idempotency-key': `"${crypto.randomUUID()}"`,
  // ⚠️ Deliberately no `Authorization`: this route takes no session, and axios
  // merges per-request headers over the client default.
  Authorization: undefined,
  ...extra,
});

/**
 * One charge for a checkout group, allocated to one vendor order — a fresh
 * order unless the case names one, because an order is paid for once and the
 * store refuses a second allocation naming it.
 */
const capture = (
  body: Record<string, unknown> = {},
  extra: Record<string, string> = {},
) => {
  const { orderId: named, amount = 1999, ...rest } = body;
  // One order id for the one vendor, or every vendor's, by vendor.
  const orderId =
    typeof named === 'object' && named !== null
      ? named
      : { 'vendor-1': named ?? `order-${crypto.randomUUID()}` };
  // As a checkout's flow asks: each card vendor's share, and the order each
  // vendor's segment wrote, by vendor. The charge is the shares' sum.
  return service.client.post(
    '/api/payment',
    {
      groupId: `group-${crypto.randomUUID()}`,
      currency: 'GTQ',
      paymentMethod: 'card',
      shares: [{ vendorId: 'vendor-1', amount }],
      orderId,
      ...rest,
    },
    { headers: crossing(extra) },
  );
};

describe('capturing a payment', () => {
  it('writes it and answers 200', async () => {
    const res = await capture();

    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe('captured');
    expect(typeof res.data.data.id).toBe('string');
  });

  it('takes one charge for a group and allocates a share to each vendor order', async () => {
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    const res = await capture({
      shares: [
        { vendorId: 'vendor-1', amount: 2000 },
        { vendorId: 'vendor-2', amount: 1000 },
      ],
      orderId: { 'vendor-1': first, 'vendor-2': second },
    });

    expect(res.status).toBe(200);
    const shares = await service.client.get('/api/payment-allocation', {
      params: { rsql: `orderId==${second}` },
    });
    expect(shares.status).toBe(200);
    expect(shares.data.data.items).toEqual([
      expect.objectContaining({
        orderId: second,
        vendorId: 'vendor-2',
        captured: 1000,
        refunded: 0,
      }),
    ]);
  });

  it('refuses a share whose vendor wrote no order', async () => {
    const res = await capture({
      shares: [
        { vendorId: 'vendor-1', amount: 2000 },
        { vendorId: 'vendor-2', amount: 1000 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  /**
   * ⚠️ **Server-owned.** A body claiming `captured` before anyone was asked
   * would assert money nobody took; a body choosing the id could overwrite
   * another payment.
   */
  it('ignores a status and an id supplied by the caller', async () => {
    const res = await capture({ id: 'chosen', status: 'captured' });

    expect(res.status).toBe(200);
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

  it('refuses a body that allocates the money to no order', async () => {
    const res = await service.client.post(
      '/api/payment',
      { groupId: 'group-1', amount: 1, currency: 'GTQ' },
      { headers: crossing() },
    );

    // The request schema refuses it before the domain is reached.
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalid');
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
   * ⚠️ **The assertion this whole service exists to make safe.** The flow
   * engine re-dispatches a step on a stable `Idempotency-Key`, and a capture
   * that ran twice is a customer charged twice.
   */
  it('answers the first decision rather than taking the money again', async () => {
    const commandId = `cmd-${String(Date.now())}`;

    const first = await capture({}, { 'idempotency-key': `"${commandId}"` });
    const second = await capture({}, { 'idempotency-key': `"${commandId}"` });

    expect(first.status).toBe(200);
    // `200`, not `409`: a coordinator that could not tell a duplicate from a
    // refusal would compensate a flow whose payment did in fact succeed.
    // Replayed from the ledger's command claim, the one layer that records
    // this write (ADR 0068).
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

    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('refund');
    expect(res.data.data.status).toBe('refunded');
    // The share it gives back from, resolved by the route rather than named by
    // the caller.
    expect(typeof res.data.data.allocationId).toBe('string');

    const after = await service.client.get(
      `/api/payment/${String(captured.data.data.id)}`,
    );
    // ⚠️ The assertion the whole design rests on: ADR 0054 protects the capture
    // row as the evidence a customer was charged, and money going back must not
    // erase it.
    expect(after.data.data.status).toBe('captured');
  });

  /**
   * ⚠️ A refund may be part of the share, never more than what is left of it:
   * the ledger takes it off the allocation with a guarded `$inc` before the
   * provider is called (ADR 0069).
   */
  it('refunds in parts, and refuses the part past what was captured', async () => {
    const orderId = `order-amount-${String(Date.now())}`;
    await capture({ orderId, amount: 1999 });

    const part = await refund({ orderId, amount: 999 });
    const rest = await refund({ orderId, amount: 1000 });
    const more = await refund({ orderId, amount: 1 });

    expect(part.status).toBe(200);
    expect(part.data.data.amount).toBe(999);
    expect(rest.status).toBe(200);
    expect(more.status).toBe(409);
    expect(more.data.code).toBe('refundExceedsCapture');
  });

  it('refunds what is left when no amount is named', async () => {
    const orderId = `order-whole-${String(Date.now())}`;
    await capture({ orderId, amount: 1999 });

    const res = await refund({ orderId });

    expect(res.status).toBe(200);
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

    // The request schema refuses it before the domain is reached.
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalid');
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

    const first = await refund(
      { orderId },
      { 'idempotency-key': `"${commandId}"` },
    );
    const second = await refund(
      { orderId },
      { 'idempotency-key': `"${commandId}"` },
    );

    expect(first.status).toBe(200);
    // Replayed from the ledger's command claim, the one layer that records
    // this write (ADR 0068).
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);
  });

  /**
   * ⚠️ The other half of the guard, and a different question: two *distinct*
   * commands aimed at one share. The guarded `$inc` is what refuses the second,
   * before the provider moves any money.
   */
  it('gives a share back once, however many commands ask for all of it', async () => {
    const orderId = `order-twice-${String(Date.now())}`;
    await capture({ orderId });

    const first = await refund({ orderId }, { 'idempotency-key': '"cmd-a"' });
    const second = await refund({ orderId }, { 'idempotency-key': '"cmd-b"' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.data.code).toBe('refundExceedsCapture');
  });
});

describe('cash on delivery', () => {
  it('records a courier’s collection as a cod payment for the one order', async () => {
    const orderId = `order-cod-${String(Date.now())}`;
    const res = await service.client.post(
      '/api/collection',
      {
        groupId: 'group-cod',
        orderId,
        vendorId: 'vendor-1',
        amount: 2500,
        currency: 'GTQ',
      },
      { headers: crossing() },
    );

    expect(res.status).toBe(200);
    expect(res.data.data).toMatchObject({
      paymentMethod: 'cod',
      status: 'captured',
      amount: 2500,
    });
  });

  it('refuses an order over the limit before anything is held', async () => {
    const res = await service.client.post(
      '/api/cod-eligibility',
      { vendorId: 'vendor-1', amount: 150_001 },
      { headers: crossing() },
    );

    expect(res.status).toBe(422);
    expect(res.data.code).toBe('codOverLimit');
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
