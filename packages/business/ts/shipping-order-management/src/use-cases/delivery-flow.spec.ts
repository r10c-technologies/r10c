import { IdempotencyKeyTag } from '@entifix/business';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../entities/shipping-order/index.js';
import { ShippingOrderStoreTag } from '../ports/shipping-order-store.js';
import { makeInMemoryShippingOrderStore } from '../testing/in-memory-shipping-order-store.js';
import { ShippingLine } from '../values/shipping-line.js';
import {
  DELIVERY_RECIPE,
  deliveryInput,
  dispatchShipment,
} from './delivery-flow.js';

const ORG = 'org-1';

const aShipment = () =>
  Object.assign(new ShippingOrder(), {
    id: 'ord-1',
    orderId: 'ord-1',
    groupId: 'grp-1',
    paymentMethod: 'cod',
    amountDue: 2500,
    currency: 'GTQ',
    lines: [new ShippingLine('o-1', 2)],
  });

type R = ShippingOrderStoreTag | FlowStarterTag;

const world = async () => {
  const store = makeInMemoryShippingOrderStore();
  await Effect.runPromise(store.open(ORG, aShipment(), undefined));
  const started: Array<{ recipe: string; input: unknown; key: string }> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(ShippingOrderStoreTag, store),
    Layer.succeed(
      FlowStarterTag,
      makeScriptedFlowStarter((recipe, input, key) => {
        started.push({ recipe, input, key });
        return acceptedAnswer(`flow-${String(started.length)}`);
      }),
    ),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const refusal = <A, E>(effect: Effect.Effect<A, E, R>) =>
    run(Effect.flip(effect)) as Promise<{ code: string }>;
  return { store, started, run, refusal };
};

const dispatch = { organizationId: ORG, shippingOrderId: 'ord-1' };

describe('dispatchShipment', () => {
  it('starts the delivery flow from the stored shipment, and answers the flow', async () => {
    const { run, started } = await world();

    const accepted = await run(dispatchShipment(dispatch));

    expect(accepted.flowId).toBe('flow-1');
    expect(started).toEqual([
      {
        recipe: DELIVERY_RECIPE,
        input: {
          shippingOrderId: 'ord-1',
          orderId: 'ord-1',
          groupId: 'grp-1',
          vendorId: ORG,
          paymentMethod: 'cod',
          amountDue: 2500,
          currency: 'GTQ',
          lines: [{ offeringId: 'o-1', quantity: 2 }],
        },
        key: expect.stringMatching(/^delivery:ord-1:/),
      },
    ]);
  });

  it('keys a retried request to its own flow, and a fresh request to a new one', async () => {
    const { run, started } = await world();

    await run(
      dispatchShipment(dispatch).pipe(
        Effect.provideService(IdempotencyKeyTag, 'req-1'),
      ),
    );
    await run(dispatchShipment(dispatch));

    expect(started[0]?.key).toBe('delivery:ord-1:req-1');
    // Never the shipment alone: a dispatch whose flow failed against a hold
    // that was later released must be askable again.
    expect(started[1]?.key).not.toBe(started[0]?.key);
  });

  it('refuses a shipment that is not awaiting dispatch before starting anything', async () => {
    const { store, started, refusal } = await world();
    await Effect.runPromise(
      store.transition(ORG, 'ord-1', 'hold', new Date(), undefined),
    );

    expect((await refusal(dispatchShipment(dispatch))).code).toBe(
      'shippingOrderNotTransitionable',
    );
    expect(started).toEqual([]);
  });

  it('answers notFound for a shipment the organization does not hold', async () => {
    const { refusal } = await world();

    expect(
      (
        await refusal(
          dispatchShipment({
            organizationId: 'org-2',
            shippingOrderId: 'ord-1',
          }),
        )
      ).code,
    ).toBe('notFound');
  });

  it('states nothing the coordinator decides', () => {
    expect(Object.keys(deliveryInput(ORG, aShipment()))).not.toContain(
      'entitlements',
    );
  });
});
