import { type EntityApiContext, IdempotencyKeyTag } from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import {
  CancelWindowSeconds,
  CheckoutGroup,
  CheckoutGroupStoreTag,
  digestOf,
  OrderItem,
  ProductOrder,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { makeInMemoryOrderStores } from '@r10c/business-ts-order-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  checkoutGroupApi,
  productOrderApi,
  productOrderEndpoints,
} from './product-order-api.js';

const GROUP = '2c3d9a10-1f5e-4a9b-8e0f-5b2f7c1e6d40';
const NONCE = 'the-nonce';

const context = (principal?: Record<string, unknown>): EntityApiContext => ({
  ...(principal === undefined
    ? {}
    : { principal: principal as unknown as EntityApiContext['principal'] }),
  links: {
    record: id => [{ rel: 'self', href: `/api/x/${String(id)}` }],
    collection: () => [],
  },
});
const operator = context({ partyRole: 'operator' });

const anOrder = (vendorId = 'v-1') =>
  Object.assign(new ProductOrder('buyer-1'), {
    vendorId,
    groupId: GROUP,
    paymentMethod: 'card',
    items: [new OrderItem('offering-1', 1, 10, 'GTQ')],
  });

/**
 * One pair of stores per case; the coordinator accepts every cancellation and
 * answers the flow to follow.
 */
const world = () => {
  const stores = makeInMemoryOrderStores();
  const started: { recipe: string; input: unknown }[] = [];
  const flows = makeScriptedFlowStarter((recipe, input) => {
    started.push({ recipe, input });
    return recipe === 'cancellation' ? acceptedAnswer('flow-1') : undefined;
  });
  const layer = Layer.mergeAll(
    Layer.succeed(ProductOrderStoreTag, stores.orders),
    Layer.succeed(CheckoutGroupStoreTag, stores.groups),
    Layer.succeed(FlowStarterTag, flows),
    Layer.succeed(CancelWindowSeconds, 600),
  );
  type R =
    | ProductOrderStoreTag
    | CheckoutGroupStoreTag
    | FlowStarterTag
    | CancelWindowSeconds;
  return {
    stores,
    started,
    run: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.provide(effect, layer)),
    refusal: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.flip(Effect.provide(effect, layer))) as Promise<{
        code: string;
      }>,
  };
};

const keyed = <A, E, R>(effect: Effect.Effect<A, E, R>, key: string) =>
  Effect.provideService(effect, IdempotencyKeyTag, key);

const [cancel] = productOrderApi.options.useCases;
const [
  buyerCancellation,
  buyerReceiptRead,
  claim,
  release,
  confirm,
  dispatch,
  close,
] = productOrderEndpoints;

/** A flow step's body: the record's members, flat — an envelope's `data`. */
const flatOf = (...args: Parameters<typeof makeEntityEnvelope>) =>
  (makeEntityEnvelope(...args) as unknown as { data: Record<string, unknown> })
    .data;

const open = () =>
  checkoutGroupApi.options.override.create.handler(
    {
      payload: flatOf(
        CheckoutGroup,
        Object.assign(new CheckoutGroup(), {
          id: GROUP,
          buyerId: 'buyer-1',
          cancelDigest: digestOf(NONCE),
        }),
      ),
    },
    operator,
  );

const place = (order: ProductOrder, extraLines: unknown[] = []) => {
  const payload = flatOf(ProductOrder, order);
  payload['items'] = [...(payload['items'] as unknown[]), ...extraLines];
  return productOrderApi.options.override.create.handler({ payload }, operator);
};

const at = (handler: { handler: (input: never) => unknown }, input: object) =>
  handler.handler(input as never) as Effect.Effect<
    { data: { id: string; status: string } },
    never,
    never
  >;

/** A group with one placed order in it, its id answered. */
const seeded = async (w: ReturnType<typeof world>) => {
  await w.run(open());
  const placed = await w.run(place(anOrder()));
  return placed.data.id as string;
};

describe('the declarations', () => {
  it('read behind the grant and write only by crossing, narrowed per caller', () => {
    for (const api of [productOrderApi, checkoutGroupApi]) {
      expect(api.options.guard).toEqual({
        read: { kind: 'permission' },
        write: { kind: 'crossing', organization: false },
      });
      expect(api.options.override.create.idempotent).toBe('unit');
    }
    expect(buyerReceiptRead.descriptor.guard).toEqual({ kind: 'public' });
  });
});

describe('a checkout', () => {
  it('opens the group under the flow’s id and places each vendor’s order into it', async () => {
    const w = world();

    const group = await w.run(keyed(open(), 'g-1'));
    const first = await w.run(place(anOrder('v-1')));
    await w.run(place(anOrder('v-2')));

    expect(group.data.id).toBe(GROUP);
    expect(first.data).toMatchObject({ vendorId: 'v-1', status: 'pending' });
    expect((await w.run(w.stores.groups.get(GROUP)))?.orderIds).toHaveLength(2);
  });

  it('refuses a write whose lines name another vendor', async () => {
    const w = world();
    await w.run(open());

    const refused = await w.refusal(
      place(anOrder('v-1'), [
        {
          offeringId: 'x',
          vendorId: 'v-2',
          quantity: 1,
          amount: 1,
          currency: 'GTQ',
        },
      ]),
    );

    expect(refused.code).toBe('invalidBody');
  });

  it('refuses a write that carries no lines at all', async () => {
    const w = world();
    await w.run(open());
    const payload = flatOf(ProductOrder, anOrder());
    delete payload['items'];

    const refused = await w.refusal(
      productOrderApi.options.override.create.handler({ payload }, operator),
    );

    expect(refused.code).toBe('invalidBody');
  });

  it('compensates an order and a group, and says when there was nothing', async () => {
    const w = world();
    const orderId = await seeded(w);
    const removeOrder = productOrderApi.options.override.delete.handler;
    const removeGroup = checkoutGroupApi.options.override.delete.handler;

    const order = await w.run(removeOrder({ params: { id: orderId } }));
    const group = await w.run(removeGroup({ params: { id: GROUP } }));
    const again = await w.run(removeGroup({ params: { id: GROUP } }));
    const gone = await w.run(removeOrder({ params: { id: orderId } }));

    expect([order, group, again, gone].map(answer => answer.outcome)).toEqual([
      'deleted',
      'deleted',
      'not-found',
      'not-found',
    ]);
  });
});

describe('the crossing moves', () => {
  it('confirm, dispatch and close an order fulfilled', async () => {
    const w = world();
    const orderId = await seeded(w);
    const params = { params: { id: orderId } };

    await w.run(at(confirm, params));
    await w.run(at(dispatch, params));
    const done = await w.run(
      at(close, { ...params, payload: { outcome: 'fulfilled' } }),
    );

    expect(done.data.status).toBe('fulfilled');
  });

  it('close a dispatched parcel cancelled, and refuse a move from the wrong place', async () => {
    const w = world();
    const orderId = await seeded(w);
    const params = { params: { id: orderId } };

    const early = await w.refusal(at(dispatch, params));
    await w.run(at(confirm, params));
    await w.run(at(dispatch, params));
    const refused = await w.run(
      at(close, { ...params, payload: { outcome: 'cancelled' } }),
    );
    const missing = await w.refusal(
      at(close, { params: { id: 'nope' }, payload: { outcome: 'cancelled' } }),
    );

    expect(early.code).toBe('orderNotTransitionable');
    expect(refused.data.status).toBe('cancelled');
    expect(missing.code).toBe('notFound');
  });

  it('claim a paid order, release it, claim it again and settle it closed cancelled', async () => {
    const w = world();
    const orderId = await seeded(w);
    const params = { params: { id: orderId } };
    await w.run(
      w.stores.orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        orderId,
        '2026-11-03T10:00:00.000Z',
      ),
    );

    const claimed = await w.run(keyed(at(claim, params), 'k-1'));
    const replayed = await w.run(keyed(at(claim, params), 'k-1'));
    const released = await w.run(at(release, params));
    const notClaimed = await w.run(at(release, params));
    await w.run(at(claim, params));
    const settled = await w.run(
      keyed(at(close, { ...params, payload: { outcome: 'cancelled' } }), 's-1'),
    );
    const settledAgain = await w.run(
      keyed(at(close, { ...params, payload: { outcome: 'cancelled' } }), 's-1'),
    );

    expect(claimed.data.status).toBe('cancelling');
    expect(replayed.data.status).toBe('cancelling');
    expect(
      [released, notClaimed].map(
        answer => (answer as unknown as { outcome: string }).outcome,
      ),
    ).toEqual(['released', 'not-claimed']);
    expect(settled.data.status).toBe('cancelled');
    expect(settledAgain.data.status).toBe('cancelled');
  });

  it('answer a settle whose command already ran with the order as it stands', async () => {
    const w = world();
    const orderId = await seeded(w);
    const params = { params: { id: orderId } };
    await w.run(
      w.stores.orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        orderId,
        '2026-11-03T10:00:00.000Z',
      ),
    );
    await w.run(keyed(at(claim, params), 'k-1'));

    const answer = await w.run(
      keyed(at(close, { ...params, payload: { outcome: 'cancelled' } }), 'k-1'),
    );

    expect(answer.data.status).toBe('cancelling');
  });

  it('refuse a claim on an order past cancelling, and on one that is not there', async () => {
    const w = world();
    const orderId = await seeded(w);

    const pending = await w.refusal(at(claim, { params: { id: orderId } }));
    const missing = await w.refusal(at(claim, { params: { id: 'nope' } }));

    expect(pending.code).toBe('orderNotCancellable');
    expect(missing.code).toBe('notFound');
  });

  it('answer a replayed claim for an order that has since gone as not found', async () => {
    const w = world();
    const orderId = await seeded(w);
    await w.run(
      w.stores.orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        orderId,
        '2026-11-03T10:00:00.000Z',
      ),
    );
    await w.run(keyed(at(claim, { params: { id: orderId } }), 'k-1'));
    await w.run(w.stores.orders.remove(orderId));

    const refused = await w.refusal(
      keyed(at(claim, { params: { id: orderId } }), 'k-1'),
    );

    expect(refused.code).toBe('notFound');
  });
});

describe('the buyer', () => {
  it('cancels one vendor order with the group’s capability', async () => {
    const w = world();
    const orderId = await seeded(w);
    await w.run(
      w.stores.orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        orderId,
        '2026-11-03T10:00:00.000Z',
      ),
    );

    const answer = await w.run(
      at(buyerCancellation, {
        params: { id: orderId },
        payload: { cancelNonce: NONCE, capabilityDigest: 'cap' },
      }),
    );
    const refused = await w.refusal(
      at(buyerCancellation, { params: { id: orderId }, payload: {} }),
    );

    expect(answer).toMatchObject({
      meta: { type: 'flowAccepted' },
      data: { flowId: 'flow-1' },
    });
    expect(w.started[0]?.input).toMatchObject({
      orderId,
      capabilityDigest: 'cap',
    });
    expect(buyerCancellation.descriptor.accepted).toBe(true);
    expect(refused.code).toBe('cancelNotAuthorized');
  });

  it('reads the receipt back by the capability in a header, and nothing without it', async () => {
    const w = world();
    const orderId = await seeded(w);

    const receipt = (await w.run(
      at(buyerReceiptRead, {
        params: { id: GROUP },
        headers: { 'x-cancel-nonce': NONCE },
      }),
    )) as unknown as {
      group: { data: { id: string } };
      orders: { data: { id: string } }[];
    };
    const refused = await w.refusal(
      at(buyerReceiptRead, { params: { id: GROUP }, headers: {} }),
    );

    expect(receipt.group.data.id).toBe(GROUP);
    expect(receipt.orders.map(order => order.data.id)).toEqual([orderId]);
    expect(refused.code).toBe('cancelNotAuthorized');
  });
});

describe('the staff cancel verb', () => {
  it('cancels the caller’s own order and hides another vendor’s', async () => {
    const w = world();
    const orderId = await seeded(w);
    await w.run(
      w.stores.orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        orderId,
        '2026-11-03T10:00:00.000Z',
      ),
    );
    const own = context({ partyRole: 'vendor', organizationId: 'v-1' });
    const other = context({ partyRole: 'vendor', organizationId: 'v-2' });

    const answer = await w.run(
      cancel.handler({ params: { id: orderId } }, own) as never,
    );
    const hidden = await w.refusal(
      cancel.handler({ params: { id: orderId } }, other) as never,
    );
    const nobody = await w.refusal(
      cancel.handler({ params: { id: orderId } }, context()) as never,
    );

    expect(answer).toMatchObject({
      meta: { type: 'flowAccepted' },
      data: { flowId: 'flow-1' },
    });
    expect(cancel.accepted).toBe(true);
    expect(hidden.code).toBe('notFound');
    expect(nobody.code).toBe('notFound');
  });
});
