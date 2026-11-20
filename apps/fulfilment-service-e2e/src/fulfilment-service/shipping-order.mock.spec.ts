import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { bus, flowStarts, startMockService } from '../support/mock-service';
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
      orderNumber: '7KQ4-M2XD',
      groupId: 'group-1',
      flowId: 'flow-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [{ offeringId: 'o-1', name: 'Lámpara Aurora', quantity: 2 }],
      destination: {
        name: 'Ana López',
        phone: '5555-1234',
        destination: {
          departamento: '01',
          municipio: '0108',
          addressLine: '5a avenida 12-34',
        },
      },
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

/** The vendor records the parcel's guide, which a dispatch requires. */
const recordGuide = (id: string, trackingNumber = 'G-1') =>
  service.client.post(
    `/api/shipping-order/${id}/record-guide`,
    { courierKey: 'other', trackingNumber, courierName: 'Mensajería' },
    // The verb is idempotent at the edge: one decision per key.
    { headers: { 'idempotency-key': `"${crypto.randomUUID()}"` } },
  );

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

  it('refuses to dispatch a parcel with no guide, and records one', async () => {
    const id = (await open()).data.data.id as string;
    const before = flowStarts.length;

    const refused = await service.client.post(
      `/api/shipping-order/${id}/dispatch`,
      {},
    );
    const recorded = await recordGuide(id, 'G-7');
    const couriers = await service.client.get('/api/courier');

    expect(refused.status).toBe(409);
    expect(refused.data.code).toBe('guideMissing');
    expect(flowStarts).toHaveLength(before);
    expect(recorded.status).toBe(200);
    expect(recorded.data.data).toMatchObject({
      courierKey: 'other',
      courierName: 'Mensajería',
      trackingNumber: 'G-7',
    });
    expect(couriers.data.items).toEqual([
      { key: 'other', name: 'Other', trackingUrlTemplate: '' },
    ]);
  });

  it('answers the guide on the dispatch step, for the order to copy', async () => {
    const id = (await open()).data.data.id as string;
    await recordGuide(id);

    const dispatched = await step(id, 'dispatch-step');

    expect(dispatched.data.data).toMatchObject({
      status: 'dispatched',
      courierName: 'Mensajería',
      trackingNumber: 'G-1',
    });
  });

  it('dispatches by starting the delivery flow, answered 202 with the flow to follow', async () => {
    const id = (await open()).data.data.id as string;
    await recordGuide(id);

    const res = await service.client.post(
      `/api/shipping-order/${id}/dispatch`,
      {},
    );

    expect(res.status).toBe(202);
    expect(res.data.meta.type).toBe('flowAccepted');
    expect(flowStarts.at(-1)).toEqual({
      recipe: 'delivery',
      input: expect.objectContaining({
        shippingOrderId: id,
        vendorId: E2E_ORGANIZATION_ID,
        paymentMethod: 'cod',
        amountDue: 2500,
      }),
      // Keyed on the shipment and the request, never the shipment alone: a
      // dispatch whose flow lost to a hold can be asked again once released.
      key: expect.stringMatching(new RegExp(`^delivery:${id}:.+`)),
    });
    // The flow's pivot dispatches the parcel; the verb moves nothing itself.
    const read = await service.client.get(`/api/shipping-order/${id}`);
    expect(read.data.data.status).toBe('awaiting-dispatch');
  });

  it('refuses to dispatch a held shipment before any flow starts', async () => {
    const id = (await open()).data.data.id as string;
    await step(id, 'hold');
    const before = flowStarts.length;

    const res = await service.client.post(
      `/api/shipping-order/${id}/dispatch`,
      {},
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('shippingOrderNotTransitionable');
    expect(flowStarts).toHaveLength(before);
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
