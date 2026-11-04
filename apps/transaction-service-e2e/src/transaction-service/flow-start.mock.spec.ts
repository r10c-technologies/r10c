import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { PROVISIONED_VENDOR, startMockService } from '../support/mock-service';
import { bearerFor, E2E_CROSSING_TOKEN } from '../support/tokens';

/**
 * `POST /api/flow/checkout` and `POST /api/flow/cancellation` — a flow
 * started and answered `202` with what to follow (ADR 0066, #486, #487).
 *
 * The real routes, guards and grant table, over the engine's fake: what is
 * proven here is who may start a flow, what the coordinator verifies before
 * composing, and that a repeated key names one flow. That a flow runs is the
 * engine's own suite's, and the live pass's.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'TRANSACTION_SERVICE_URL',
  startMock: startMockService,
});

const crossing = (key = globalThis.crypto.randomUUID()) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'idempotency-key': `"${key}"`,
});

const basket = (vendorId = PROVISIONED_VENDOR) => ({
  channel: { type: 'storefront' },
  vendors: [
    {
      vendorId,
      paymentMethod: 'card',
      lines: [{ offeringId: 'o-1', quantity: 1, amount: 500, currency: 'GTQ' }],
    },
  ],
  totals: [{ currency: 'GTQ', amount: 500 }],
  capabilityDigest: 'digest',
});

describe('POST /api/flow/checkout', () => {
  it('starts a checkout and answers 202 with the flow to follow', async () => {
    const res = await service.client.post('/api/flow/checkout', basket(), {
      headers: crossing(),
    });

    expect(res.status).toBe(202);
    expect(res.data.meta.type).toBe('flowAccepted');
    const { flowId, links } = res.data.data;
    expect(links).toEqual([
      { rel: 'status', href: `/api/realtime/flow/${flowId}` },
      { rel: 'stream', href: '/api/realtime/stream' },
    ]);
  });

  it('names the first flow again for a repeated key', async () => {
    const key = globalThis.crypto.randomUUID();
    const first = await service.client.post('/api/flow/checkout', basket(), {
      headers: crossing(key),
    });
    const again = await service.client.post('/api/flow/checkout', basket(), {
      headers: crossing(key),
    });

    expect(again.status).toBe(202);
    expect(again.data.data.flowId).toBe(first.data.data.flowId);
  });

  it('refuses a vendor it finds unprovisioned, whatever the basket said', async () => {
    const res = await service.client.post(
      '/api/flow/checkout',
      basket('unprovisioned-vendor'),
      { headers: crossing() },
    );

    expect(res.status).toBe(403);
    expect(res.data.code).toBe('flowRequirementsUnmet');
  });

  it('refuses a start that is no basket', async () => {
    const res = await service.client.post(
      '/api/flow/checkout',
      { vendors: [] },
      { headers: crossing() },
    );

    expect(res.status).toBe(400);
  });

  it('refuses a start with no crossing token, and a session even an admin one', async () => {
    const none = await service.client.post('/api/flow/checkout', basket(), {
      headers: { 'idempotency-key': '"k"', Authorization: '' },
    });
    const session = await service.client.post('/api/flow/checkout', basket(), {
      headers: {
        'idempotency-key': '"k"',
        Authorization: await bearerFor(['admin']),
      },
    });

    expect(none.status).toBe(401);
    expect(session.status).toBe(401);
  });

  it('refuses a start with no Idempotency-Key', async () => {
    const res = await service.client.post('/api/flow/checkout', basket(), {
      headers: { 'x-crossing-token': E2E_CROSSING_TOKEN },
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/flow/cancellation', () => {
  it('starts a cancellation of one vendor order', async () => {
    const res = await service.client.post(
      '/api/flow/cancellation',
      {
        orderId: 'ord-1',
        vendorId: PROVISIONED_VENDOR,
        paymentMethod: 'card',
        lines: [{ offeringId: 'o-1', quantity: 1 }],
        shipped: true,
      },
      { headers: crossing() },
    );

    expect(res.status).toBe(202);
    expect(res.data.meta.type).toBe('flowAccepted');
  });
});
