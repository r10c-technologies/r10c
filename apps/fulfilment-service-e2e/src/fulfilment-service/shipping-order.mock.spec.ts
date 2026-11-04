import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { bus, startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
} from '../support/tokens';

/**
 * A vendor's shipment, from the flow that opens it to the courier's report.
 *
 * The flow's steps take a crossing token and the vendor's organization in a
 * header, and **no session**; the vendor's reads and verbs take their session
 * and no token (ADR 0023, ADR 0070).
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'FULFILMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const crossing = (extra: Record<string, string> = {}) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'idempotency-key': `"${crypto.randomUUID()}"`,
  'x-organization-id': E2E_ORGANIZATION_ID,
  // ⚠️ Deliberately no `Authorization`: these routes take no session.
  Authorization: undefined,
  ...extra,
});

const open = (extra: Record<string, string> = {}) =>
  service.client.post(
    '/api/shipping-order',
    {
      orderId: `order-${crypto.randomUUID()}`,
      groupId: 'group-1',
      flowId: 'flow-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [{ offeringId: 'o-1', quantity: 2 }],
    },
    { headers: crossing(extra) },
  );

const step = (id: string, path: string, method: 'post' | 'delete' = 'post') =>
  method === 'post'
    ? service.client.post(
        `/api/shipping-order/${id}/${path}`,
        {},
        {
          headers: crossing(),
        },
      )
    : service.client.delete(`/api/shipping-order/${id}/${path}`, {
        headers: crossing(),
      });

describe('the flow’s steps', () => {
  it('opens a shipment awaiting dispatch', async () => {
    const res = await open();

    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe('awaiting-dispatch');
  });

  it('holds and releases it, then dispatches it and announces the dispatch', async () => {
    const id = (await open()).data.data.id as string;

    const held = await step(id, 'hold');
    const released = await step(id, 'hold', 'delete');
    const dispatched = await step(id, 'dispatch-step');

    expect(held.data.data.status).toBe('held');
    expect(released.data.data.status).toBe('awaiting-dispatch');
    expect(dispatched.data.data.status).toBe('dispatched');
    expect(
      bus.published
        .filter(event => event.aggregate?.id === id)
        .map(event => event.name),
    ).toEqual(['shipping-order.dispatched']);
  });

  it('refuses a dispatch on a held shipment, naming where it stood', async () => {
    const id = (await open()).data.data.id as string;
    await step(id, 'hold');

    const res = await step(id, 'dispatch-step');

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('shippingOrderNotTransitionable');
  });

  it('refuses a session on a crossing step, even super-admin', async () => {
    const res = await service.client.post(
      '/api/shipping-order',
      {},
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    expect(res.status).toBe(401);
  });
});

describe('the vendor', () => {
  it('records the delivery of a dispatched parcel, and the store announces it', async () => {
    const id = (await open()).data.data.id as string;
    await step(id, 'dispatch-step');

    const res = await service.client.post(
      `/api/shipping-order/${id}/record-delivery`,
      {},
    );

    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe('delivered');
    expect(
      bus.published
        .filter(event => event.aggregate?.id === id)
        .map(event => event.name),
    ).toEqual(['shipping-order.dispatched', 'shipping-order.delivered']);
  });

  it('reads their own shipments', async () => {
    const id = (await open()).data.data.id as string;

    const res = await service.client.get(`/api/shipping-order/${id}`);

    expect(res.status).toBe(200);
    expect(res.data.data.paymentMethod).toBe('cod');
  });

  it('is refused the verbs without the grant', async () => {
    const id = (await open()).data.data.id as string;

    const res = await service.client.post(
      `/api/shipping-order/${id}/dispatch`,
      {},
      { headers: { Authorization: await bearerFor(['user']) } },
    );

    expect(res.status).toBe(403);
  });
});
