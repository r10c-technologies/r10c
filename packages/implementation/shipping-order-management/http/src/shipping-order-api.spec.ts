import {
  type EntityApiContext,
  IdempotencyKeyTag,
  OrganizationIdTag,
} from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
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

type R = ShippingOrderStoreTag | OrganizationIdTag;

/** One store per case, every request bound to `acme`. */
const world = () => {
  const layer = Layer.mergeAll(
    Layer.succeed(ShippingOrderStoreTag, makeInMemoryShippingOrderStore()),
    Layer.succeed(OrganizationIdTag, 'acme'),
  );
  return {
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

const shipment = (extra: Partial<ShippingOrder> = {}) =>
  makeEntityEnvelope(
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

/** A shipment opened awaiting dispatch, its id answered. */
const opened = async (w: ReturnType<typeof world>) =>
  (await w.run(at(open, { payload: shipment() }))).data.id;

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
  it('dispatch a parcel and record its delivery, refusal and return', async () => {
    const w = world();
    const delivered = await opened(w);
    const refused = await opened(w);

    await w.run(verb(dispatch, delivered));
    const done = await w.run(verb(delivery, delivered));
    const back = await w.run(verb(returned, delivered));
    await w.run(at(dispatchStep, { params: { id: refused } }));
    const no = await w.run(verb(refusal, refused));

    expect([done, back, no].map(answer => answer.data.status)).toEqual([
      'delivered',
      'returned',
      'refused',
    ]);
  });

  it('answers a shipment that is not the caller’s as not found', async () => {
    const w = world();

    expect((await w.refusal(verb(dispatch, 'nope'))).code).toBe('notFound');
  });
});
