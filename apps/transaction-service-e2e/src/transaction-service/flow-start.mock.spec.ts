import { defineServiceE2e } from '@entifix/testing-e2e/service';
import { deliveryCorrelation } from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

import {
  calls,
  currentOrder,
  DELIVERY_DIALS,
  engine,
  PROVISIONED_VENDOR,
  startMockService,
} from '../support/mock-service';
import { bearerFor, E2E_CROSSING_TOKEN } from '../support/tokens';

/**
 * `POST /api/flow/checkout`, `/cancellation` and `/delivery` — a flow
 * started and answered `202` with what to follow (ADR 0066, #486–#488).
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

/**
 * The delivery flow (#488), driven as the coordinator's `shipping-order.*`
 * consumer drives it: a correlated signal per report, by shipment. The
 * participants are fakes, so what is proven is which steps a report leads to.
 */
describe('POST /api/flow/delivery', () => {
  const start = async (orderId: string, paymentMethod: 'card' | 'cod') => {
    currentOrder.id = orderId;
    return service.client.post(
      '/api/flow/delivery',
      {
        shippingOrderId: orderId,
        orderId,
        groupId: 'grp-1',
        vendorId: PROVISIONED_VENDOR,
        paymentMethod,
        amountDue: paymentMethod === 'cod' ? 500 : 0,
        currency: 'GTQ',
        lines: [{ offeringId: 'o-1', quantity: 1 }],
      },
      { headers: crossing() },
    );
  };

  const report = (orderId: string, outcome: string) => {
    currentOrder.id = orderId;
    return Effect.runPromise(
      Effect.result(
        engine.signalCorrelated(deliveryCorrelation(orderId), { outcome }),
      ),
    );
  };

  /** The steps called for one order, without its vendor segment. */
  const stepsOf = (orderId: string) =>
    calls
      .filter(call => call.orderId === orderId)
      .map(call => call.step.split(':').slice(1).join(':'));

  it('dispatches and waits, answered 202, on the dispatch-step crossing', async () => {
    const res = await start('ord-wait', 'cod');

    expect(res.status).toBe(202);
    expect(stepsOf('ord-wait')).toEqual([
      'fulfilment.dispatch',
      'order.mark-dispatched',
    ]);
  });

  it('records the cash collected for a delivered COD order, and closes it fulfilled', async () => {
    await start('ord-cod-delivered', 'cod');

    expect(await report('ord-cod-delivered', 'delivered')).toMatchObject({
      _tag: 'Success',
    });
    expect(stepsOf('ord-cod-delivered')).toEqual([
      'fulfilment.dispatch',
      'order.mark-dispatched',
      'payment.record-collection',
      'order.close-fulfilled',
    ]);
  });

  it('puts a refused COD parcel back once returned, and closes the order cancelled', async () => {
    await start('ord-cod-refused', 'cod');

    await report('ord-cod-refused', 'refused');
    // The return is a report for the wait after, so a second refusal is not.
    expect(await report('ord-cod-refused', 'refused')).toMatchObject({
      failure: { _tag: 'FlowSignalRejected' },
    });
    await report('ord-cod-refused', 'returned');

    expect(stepsOf('ord-cod-refused')).toEqual([
      'fulfilment.dispatch',
      'order.mark-dispatched',
      'o-1:stock.restore',
      'order.close-cancelled',
    ]);
  });

  it('refunds a card order whose parcel came back', async () => {
    await start('ord-card-refused', 'card');

    await report('ord-card-refused', 'refused');
    await report('ord-card-refused', 'returned');

    expect(stepsOf('ord-card-refused').slice(-3)).toEqual([
      'o-1:stock.restore',
      'order.close-cancelled',
      'payment.refund-after-delivery',
    ]);
  });

  it('strands a flow whose refused parcel never comes back, and puts nothing back', async () => {
    const res = await start('ord-lost', 'card');
    await report('ord-lost', 'refused');

    await new Promise(resolve => {
      setTimeout(resolve, DELIVERY_DIALS.awaitReturnMs * 3);
    });

    const status = await Effect.runPromise(
      engine.status(res.data.data.flowId as string),
    );
    expect(status).toMatchObject({ state: 'stranded' });
    expect(stepsOf('ord-lost')).toEqual([
      'fulfilment.dispatch',
      'order.mark-dispatched',
    ]);
  });

  it('refuses a start that presents no crossing token', async () => {
    const res = await service.client.post(
      '/api/flow/delivery',
      { shippingOrderId: 'ord-1' },
      { headers: { 'idempotency-key': '"k"', Authorization: '' } },
    );

    expect(res.status).toBe(401);
  });
});
