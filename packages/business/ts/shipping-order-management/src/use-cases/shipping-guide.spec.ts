import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../entities/shipping-order/index.js';
import {
  type CourierTracking,
  CourierTrackingTag,
} from '../ports/courier-tracking.js';
import { CouriersTag } from '../ports/couriers.js';
import {
  type ShippingOrderStore,
  ShippingOrderStoreTag,
} from '../ports/shipping-order-store.js';
import { makeInMemoryShippingOrderStore } from '../testing/in-memory-shipping-order-store.js';
import { ShippingLine } from '../values/shipping-line.js';
import { applyCourierReports, recordGuide } from './shipping-guide.js';

const ORG = 'org-1';
const AT = new Date('2026-11-19T10:00:00.000Z');

const aShipment = (id: string) =>
  Object.assign(new ShippingOrder(), {
    id,
    orderId: id,
    groupId: 'grp-1',
    paymentMethod: 'card',
    currency: 'GTQ',
    lines: [new ShippingLine('o-1', 'Lámpara', 1)],
  });

const COURIERS = [
  {
    key: 'fast',
    name: 'Fast',
    trackingUrlTemplate: 'https://track.example/{guide}',
  },
];

const world = async (
  tracking: CourierTracking = { reports: () => Effect.succeed([]) },
  wrap: (store: ShippingOrderStore) => ShippingOrderStore = store => store,
) => {
  const inner = makeInMemoryShippingOrderStore();
  for (const id of ['s-1', 's-2']) {
    await Effect.runPromise(inner.open(ORG, aShipment(id), undefined));
  }
  const store = wrap(inner);
  const layer = Layer.mergeAll(
    Layer.succeed(ShippingOrderStoreTag, store),
    Layer.succeed(CouriersTag, COURIERS),
    Layer.succeed(CourierTrackingTag, tracking),
  );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      ShippingOrderStoreTag | CouriersTag | CourierTrackingTag
    >,
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const refusal = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      ShippingOrderStoreTag | CouriersTag | CourierTrackingTag
    >,
  ) => run(Effect.flip(effect)) as Promise<Record<string, unknown>>;
  return { store: inner, run, refusal };
};

const guide = (shippingOrderId: string, trackingNumber = 'G-1') =>
  recordGuide({
    organizationId: ORG,
    shippingOrderId,
    payload: { courierKey: 'fast', trackingNumber },
  });

describe('recordGuide', () => {
  it('records the guide with its courier copied and its link rendered', async () => {
    const { run } = await world();

    expect(await run(guide('s-1'))).toMatchObject({
      courierKey: 'fast',
      courierName: 'Fast',
      trackingNumber: 'G-1',
      trackingUrl: 'https://track.example/G-1',
    });
  });

  it('refuses an unknown shipment, a bad guide and a shipment that moved on', async () => {
    const { run, store, refusal } = await world();

    expect((await refusal(guide('nope'))).code).toBe('notFound');
    const invalid = await refusal(guide('s-1', ''));
    expect(invalid).toMatchObject({
      code: 'invalidGuide',
      field: 'trackingNumber',
    });
    expect((invalid as unknown as Error).message).toBe(
      'a tracking number has 1 to 64 characters',
    );
    await run(guide('s-1'));
    await Effect.runPromise(
      store.transition(ORG, 's-1', 'dispatch', AT, undefined),
    );
    expect(await refusal(guide('s-1'))).toMatchObject({
      code: 'shippingOrderNotTransitionable',
      standing: 'dispatched',
      transition: 'record-guide',
    });
  });

  it('refuses a guide whose shipment moved between the read and the write', async () => {
    const { refusal } = await world(undefined, store => ({
      ...store,
      recordGuide: () => Effect.succeed(undefined),
    }));

    expect(await refusal(guide('s-1'))).toMatchObject({
      code: 'shippingOrderNotTransitionable',
      standing: 'awaiting-dispatch',
    });
  });

  it('names the stored status when the shipment vanished in between', async () => {
    let reads = 0;
    const { refusal } = await world(undefined, store => ({
      ...store,
      get: (organizationId, id) =>
        reads++ === 0
          ? store.get(organizationId, id)
          : Effect.succeed(undefined),
      recordGuide: () => Effect.succeed(undefined),
    }));

    expect(await refusal(guide('s-1'))).toMatchObject({
      standing: 'awaiting-dispatch',
    });
  });
});

describe('applyCourierReports', () => {
  it('asks nothing when no parcel is in transit', async () => {
    let asked = 0;
    const { run } = await world({
      reports: () => {
        asked += 1;
        return Effect.succeed([]);
      },
    });

    expect(await run(applyCourierReports(AT))).toBe(0);
    expect(asked).toBe(0);
  });

  it('records each report as a delivery, and lets a parcel already reported on go', async () => {
    const { run, store } = await world({
      reports: parcels =>
        Effect.succeed([
          ...parcels.map(parcel => ({
            organizationId: parcel.organizationId,
            shippingOrderId: parcel.shippingOrderId,
            trackingNumber: parcel.trackingNumber,
            outcome: 'delivered' as const,
            at: AT,
          })),
          {
            organizationId: ORG,
            shippingOrderId: 's-2',
            trackingNumber: 'G-1',
            outcome: 'delivered' as const,
            at: AT,
          },
          {
            organizationId: ORG,
            shippingOrderId: 'gone',
            trackingNumber: 'G-9',
            outcome: 'delivered' as const,
            at: AT,
          },
        ]),
    });
    await run(guide('s-1'));
    await Effect.runPromise(
      store.transition(ORG, 's-1', 'dispatch', AT, undefined),
    );

    expect(await run(applyCourierReports(AT))).toBe(1);
    expect(await Effect.runPromise(store.get(ORG, 's-1'))).toMatchObject({
      status: 'delivered',
      deliveredAt: AT,
    });
  });
});
