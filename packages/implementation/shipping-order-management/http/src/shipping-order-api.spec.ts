import {
  type EntityApiContext,
  IdempotencyKeyTag,
  OrganizationIdTag,
} from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import {
  ShippingLine,
  ShippingOrder,
  ShippingOrderStoreTag,
} from '@r10c/business-ts-shipping-order-management';
import { makeInMemoryShippingOrderStore } from '@r10c/business-ts-shipping-order-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  shippingOrderApi,
  shippingOrderEndpoints,
} from './shipping-order-api.js';

const context: EntityApiContext = {
  organizationId: 'acme',
  links: {
    record: id => [{ rel: 'self', href: `/api/x/${String(id)}` }],
    collection: () => [],
  },
};

type R = ShippingOrderStoreTag | OrganizationIdTag | FlowStarterTag;

/** One store per case, every request bound to `acme`, every flow start kept. */
const world = () => {
  const started: Array<{ recipe: string; input: unknown }> = [];
  const store = makeInMemoryShippingOrderStore();
  const layer = Layer.mergeAll(
    Layer.succeed(ShippingOrderStoreTag, store),
    Layer.succeed(OrganizationIdTag, 'acme'),
    Layer.succeed(
      FlowStarterTag,
      makeScriptedFlowStarter((recipe, input) => {
        started.push({ recipe, input });
        return acceptedAnswer(`flow-${String(started.length)}`);
      }),
    ),
  );
  return {
    started,
    statusOf: async (id: string) =>
      (await Effect.runPromise(store.get('acme', id)))?.status,
    run: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.provide(effect, layer)) as Promise<{
        data: { id: string; status: string };
      }>,
    refusal: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.flip(Effect.provide(effect, layer))) as Promise<{
        code: string;
      }>,
  };
};

const [open, hold, release, withdrawal, dispatchStep] = shippingOrderEndpoints;
const [dispatch, delivery, refusal, returned] =
  shippingOrderApi.options.useCases;

const at = (endpoint: { handler: (input: never) => unknown }, input: object) =>
  endpoint.handler(input as never) as Effect.Effect<unknown, unknown, R>;

const verb = (
  endpoint: { handler: (request: never, context: never) => unknown },
  id: string,
) =>
  endpoint.handler(
    { params: { id } } as never,
    context as never,
  ) as Effect.Effect<unknown, unknown, R>;

/** A flow step's body: the record's members, flat — an envelope's `data`. */
const flatOf = (...args: Parameters<typeof makeEntityEnvelope>) =>
  (makeEntityEnvelope(...args) as unknown as { data: Record<string, unknown> })
    .data;

const shipment = (extra: Partial<ShippingOrder> = {}) =>
  flatOf(
    ShippingOrder,
    Object.assign(new ShippingOrder(), {
      orderId: 'order-1',
      groupId: 'group-1',
      paymentMethod: 'cod',
      amountDue: 2500,
      currency: 'GTQ',
      lines: [new ShippingLine('o-1', 2)],
      ...extra,
    }),
  );

/** A shipment opened awaiting dispatch for one order, its id answered. */
const opened = async (w: ReturnType<typeof world>, orderId = 'order-1') =>
  (await w.run(at(open, { payload: shipment({ orderId }) }))).data.id;

describe('the declarations', () => {
  it('read a vendor’s own shipments behind their organization, and move them by crossing', () => {
    expect(shippingOrderApi.options.guard).toEqual({ kind: 'organization' });
    expect(dispatchStep.descriptor.guard).toEqual({
      kind: 'crossing',
      permission: 'shipping-order-management:shipping-order:dispatch-step',
      organization: true,
    });
    expect(release.descriptor.guard).toMatchObject({
      permission: 'shipping-order-management:shipping-order:hold',
    });
  });
});

describe('the flow’s steps', () => {
  it('opens a shipment awaiting dispatch, once per key', async () => {
    const w = world();

    const first = await w.run(
      Effect.provideService(
        at(open, { payload: shipment() }),
        IdempotencyKeyTag,
        'k-1',
      ),
    );
    const again = await w.run(
      Effect.provideService(
        at(open, { payload: shipment() }),
        IdempotencyKeyTag,
        'k-1',
      ),
    );

    expect(first.data.status).toBe('awaiting-dispatch');
    // One shipment per vendor order, under the order's own id.
    expect(first.data.id).toBe('order-1');
    expect(again.data.id).toBe(first.data.id);
  });

  it('refuses a shipment with no order or no lines', async () => {
    const w = world();

    const orderless = await w.refusal(
      at(open, { payload: shipment({ orderId: '' }) }),
    );
    const empty = await w.refusal(
      at(open, { payload: shipment({ lines: [] }) }),
    );

    expect([orderless.code, empty.code]).toEqual([
      'invalidBody',
      'invalidBody',
    ]);
  });

  it('holds, releases, withdraws, and refuses a dispatch on what was withdrawn', async () => {
    const w = world();
    const id = await opened(w);

    const held = await w.run(at(hold, { params: { id } }));
    const released = await w.run(at(release, { params: { id } }));
    const withdrawn = await w.run(at(withdrawal, { params: { id } }));
    const late = await w.refusal(at(dispatchStep, { params: { id } }));

    expect(
      [held, released, withdrawn].map(answer => answer.data.status),
    ).toEqual(['held', 'awaiting-dispatch', 'withdrawn']);
    expect(late.code).toBe('shippingOrderNotTransitionable');
  });
});

describe('the vendor’s verbs', () => {
  it('dispatch by starting the delivery flow, and answer the flow to follow', async () => {
    const w = world();
    const id = await opened(w);

    const answer = (await w.run(verb(dispatch, id))) as unknown as {
      meta: { type: string };
      data: { flowId: string };
    };

    expect(answer.meta.type).toBe('flowAccepted');
    expect(answer.data.flowId).toBe('flow-1');
    expect(w.started).toEqual([
      {
        recipe: 'delivery',
        input: expect.objectContaining({
          shippingOrderId: id,
          vendorId: 'acme',
        }),
      },
    ]);
    // The flow's pivot dispatches it; the verb itself moves nothing.
    expect(await w.statusOf(id)).toBe('awaiting-dispatch');
  });

  it('record what the courier reported, once the flow dispatched the parcel', async () => {
    const w = world();
    const delivered = await opened(w);
    const refused = await opened(w, 'order-2');

    await w.run(at(dispatchStep, { params: { id: delivered } }));
    await w.run(at(dispatchStep, { params: { id: refused } }));
    const done = await w.run(verb(delivery, delivered));
    const no = await w.run(verb(refusal, refused));
    const back = await w.run(verb(returned, refused));

    expect([done, no, back].map(answer => answer.data.status)).toEqual([
      'delivered',
      'refused',
      'returned',
    ]);
    // A delivered parcel is the delivery flow's end, and comes back as no
    // return of this one.
    expect((await w.refusal(verb(returned, delivered))).code).toBe(
      'shippingOrderNotTransitionable',
    );
  });

  it('answers a shipment that is not the caller’s as not found', async () => {
    const w = world();

    expect((await w.refusal(verb(dispatch, 'nope'))).code).toBe('notFound');
  });
});
