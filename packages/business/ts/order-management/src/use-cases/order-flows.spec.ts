import { IdempotencyKeyTag } from '@entifix/business';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../entities/checkout-group/index.js';
import { ProductOrder } from '../entities/product-order/index.js';
import {
  CheckoutGroupStoreTag,
  ProductOrderStoreTag,
} from '../ports/product-order-store.js';
import { makeInMemoryOrderStores } from '../testing/in-memory-product-order-store.js';
import { digestOf } from '../values/cancel-capability.js';
import { OrderItem } from '../values/order-item.js';
import type { OrderScope } from '../values/order-scope.js';
import {
  buyerReceipt,
  CANCELLATION_RECIPE,
  cancellationInput,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  foreignLinesProblem,
  moveOrder,
  openGroup,
  placeOrder,
} from './order-flows.js';

const GROUP = '7b6f2b0e-6a0c-4b8e-9d55-0f0e6a3a1c11';
const NONCE = 'the-nonce';

const anOrder = (vendorId = 'v-1', groupId = GROUP) =>
  Object.assign(new ProductOrder('buyer-1'), {
    vendorId,
    groupId,
    paymentMethod: 'card',
    items: [new OrderItem('o-1', 2, 10, 'GTQ')],
  });

const aGroup = (extra: Partial<CheckoutGroup> = {}) =>
  Object.assign(new CheckoutGroup(), {
    id: GROUP,
    buyerId: 'buyer-1',
    ...extra,
  });

type R = ProductOrderStoreTag | CheckoutGroupStoreTag | FlowStarterTag;

/** The in-memory stores, and a record of every flow started on their behalf. */
const world = () => {
  const stores = makeInMemoryOrderStores();
  const started: Array<{ recipe: string; input: unknown; key: string }> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(ProductOrderStoreTag, stores.orders),
    Layer.succeed(CheckoutGroupStoreTag, stores.groups),
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
  /** A group with the buyer's capability, and one placed order in it. */
  const placed = async (status: ProductOrder['status'] = 'paid') => {
    await run(
      openGroup({
        group: aGroup({ cancelDigest: digestOf(NONCE) }),
        commandId: undefined,
        cancelWindowSeconds: 600,
      }),
    );
    const { order } = await run(
      placeOrder({ order: anOrder(), rawLines: [], commandId: undefined }),
    );
    if (status === 'paid') {
      await run(
        stores.orders.markPaid(
          { consumer: 'c', eventId: 'e' },
          String(order.id),
          '2026-10-26T10:00:00.000Z',
        ),
      );
    } else if (status !== 'pending') {
      await run(stores.orders.move(String(order.id), 'confirm', undefined));
    }
    return String(order.id);
  };
  return { run, refusal, started, stores, placed };
};

const operator: OrderScope = { kind: 'unscoped' };
const vendor = (organizationId: string): OrderScope => ({
  kind: 'vendor',
  organizationId,
});

describe('openGroup', () => {
  it('opens under the flow’s id, stamping the time and a window only with a digest', async () => {
    const { run } = world();

    const online = await run(
      openGroup({
        group: aGroup({ cancelDigest: 'digest', orderIds: ['stale'] }),
        commandId: 'g-1',
        cancelWindowSeconds: 60,
      }),
    );
    const counter = await run(
      openGroup({
        group: aGroup({ id: crypto.randomUUID() }),
        commandId: undefined,
        cancelWindowSeconds: 60,
      }),
    );

    expect(online.group.id).toBe(GROUP);
    expect(online.group.orderIds).toEqual([]);
    expect(
      (online.group.cancelWindowEndsAt as Date).getTime() -
        (online.group.placedAt as Date).getTime(),
    ).toBe(60_000);
    expect(counter.group.cancelWindowEndsAt).toBeUndefined();
  });

  it('refuses a group whose id is not a flow’s', async () => {
    const { refusal } = world();

    expect(
      (
        await refusal(
          openGroup({
            group: aGroup({ id: 'not-a-uuid' }),
            commandId: undefined,
            cancelWindowSeconds: 60,
          }),
        )
      ).code,
    ).toBe('invalidBody');
  });
});

describe('foreignLinesProblem', () => {
  it('passes lines that name no vendor or this one, and refuses one naming another', () => {
    expect(foreignLinesProblem('v-1', [{}, null, { vendorId: 'v-1' }])).toBe(
      undefined,
    );
    expect(foreignLinesProblem('v-1', [{ vendorId: 'v-2' }])).toBe(
      'every line of an order must be its own vendor’s',
    );
  });
});

describe('placeOrder', () => {
  it('stamps the id, the status and the placing time, and joins its group', async () => {
    const { run, stores } = world();
    await run(
      openGroup({
        group: aGroup(),
        commandId: undefined,
        cancelWindowSeconds: 1,
      }),
    );

    const { order } = await run(
      placeOrder({
        order: Object.assign(anOrder(), { id: 'ignored', status: 'paid' }),
        rawLines: [{ vendorId: 'v-1' }],
        commandId: 'c-1',
      }),
    );

    expect(order.id).not.toBe('ignored');
    expect(order.status).toBe('pending');
    expect(order.placedAt).toBeInstanceOf(Date);
    expect((await run(stores.groups.get(GROUP)))?.orderIds).toEqual([order.id]);
  });

  it('refuses no items, no vendor or group, and a two-vendor write', async () => {
    const { refusal } = world();
    const place = (order: ProductOrder, rawLines: unknown[] = []) =>
      refusal(placeOrder({ order, rawLines, commandId: undefined }));

    const empty = await place(Object.assign(anOrder(), { items: [] }));
    const vendorless = await place(anOrder(''));
    const groupless = await place(anOrder('v-1', ''));
    const twoVendors = await place(anOrder(), [
      { vendorId: 'v-1' },
      { vendorId: 'v-2' },
    ]);
    const nowhere = await place(anOrder('v-1', 'never-opened'));

    expect([empty, vendorless, groupless, twoVendors].map(r => r.code)).toEqual(
      ['invalidBody', 'invalidBody', 'invalidBody', 'invalidBody'],
    );
    expect(nowhere.code).toBe('notFound');
  });
});

describe('moveOrder', () => {
  it('makes a legal move, and names the order and where it stood otherwise', async () => {
    const { run, refusal, placed } = world();
    const orderId = await placed('pending');

    const confirmed = await run(
      moveOrder({ orderId, transition: 'confirm', commandId: undefined }),
    );
    const late = await refusal(
      moveOrder({
        orderId,
        transition: 'close-fulfilled',
        commandId: undefined,
      }),
    );
    const missing = await refusal(
      moveOrder({
        orderId: 'nope',
        transition: 'confirm',
        commandId: undefined,
      }),
    );

    expect(confirmed.status).toBe('confirmed');
    expect(late).toMatchObject({
      code: 'orderNotTransitionable',
      standing: 'confirmed',
      transition: 'close-fulfilled',
    });
    expect(missing.code).toBe('notFound');
  });
});

describe('cancellationInput', () => {
  it('states the order, its vendor and tender, each line to put back, and whether it shipped', () => {
    const order = Object.assign(anOrder('v-9'), { id: 'o-1' });

    expect(cancellationInput(order, 'cap')).toEqual({
      orderId: 'o-1',
      vendorId: 'v-9',
      paymentMethod: 'card',
      lines: [{ offeringId: 'o-1', quantity: 2 }],
      shipped: true,
      buyerId: 'buyer-1',
      capabilityDigest: 'cap',
    });
  });

  it('ships nothing handed over at a counter, and names no buyer a walk-in lacks', () => {
    const order = Object.assign(new ProductOrder(), {
      id: 'o-2',
      vendorId: 'v-9',
      paymentMethod: 'cash',
      channel: { id: 'c-1', name: 'Till', type: 'counter' },
      items: [new OrderItem('o-1', 1, 10, 'GTQ')],
    });

    expect(cancellationInput(order)).toMatchObject({ shipped: false });
    expect(cancellationInput(order)).not.toHaveProperty('buyerId');
    expect(cancellationInput(order)).not.toHaveProperty('capabilityDigest');
  });
});

describe('cancelOrderAsStaff', () => {
  it('lets an operator and the order’s own vendor cancel, starting the flow', async () => {
    const { run, started, placed } = world();
    const orderId = await placed();

    await run(cancelOrderAsStaff({ orderId, scope: vendor('v-1') }));
    await run(cancelOrderAsStaff({ orderId, scope: operator }));

    expect(started.map(entry => entry.recipe)).toEqual([
      CANCELLATION_RECIPE,
      CANCELLATION_RECIPE,
    ]);
    // Never keyed on the order alone: a cancellation that failed can be
    // asked for again.
    expect(new Set(started.map(entry => entry.key)).size).toBe(2);
  });

  it('answers another vendor, a buyer and an absent order alike: not found', async () => {
    const { refusal, placed } = world();
    const orderId = await placed();

    const other = await refusal(
      cancelOrderAsStaff({ orderId, scope: vendor('v-2') }),
    );
    const buyer = await refusal(
      cancelOrderAsStaff({ orderId, scope: { kind: 'buyer', partyId: 'p' } }),
    );
    const nobody = await refusal(
      cancelOrderAsStaff({ orderId, scope: { kind: 'nothing' } }),
    );
    const absent = await refusal(
      cancelOrderAsStaff({ orderId: 'nope', scope: operator }),
    );

    expect([other, buyer, nobody, absent].map(r => r.code)).toEqual([
      'notFound',
      'notFound',
      'notFound',
      'notFound',
    ]);
  });

  it('answers the flow to follow, keyed on the request’s own key when it sent one', async () => {
    const { run, started, placed } = world();
    const orderId = await placed();

    const accepted = await run(
      Effect.provideService(
        cancelOrderAsStaff({ orderId, scope: operator }),
        IdempotencyKeyTag,
        'request-1',
      ),
    );

    expect(accepted.flowId).toBe('flow-1');
    expect(started[0]?.key).toBe(`cancellation:${orderId}:request-1`);
  });

  it('refuses an order no longer cancellable before starting anything', async () => {
    const { refusal, started, placed } = world();
    const orderId = await placed('pending');

    expect(
      (await refusal(cancelOrderAsStaff({ orderId, scope: operator }))).code,
    ).toBe('orderNotCancellable');
    expect(started).toEqual([]);
  });
});

describe('cancelOrderAsBuyer', () => {
  it('cancels one vendor order with the group’s capability, and no session', async () => {
    const { run, started, placed } = world();
    const orderId = await placed('confirmed');

    await run(
      cancelOrderAsBuyer({ orderId, nonce: NONCE, capabilityDigest: 'cap' }),
    );

    expect(started).toHaveLength(1);
    expect(started[0]?.input).toMatchObject({ capabilityDigest: 'cap' });
  });

  it('answers every capability failure alike', async () => {
    const { refusal, placed } = world();
    const orderId = await placed();

    const wrong = await refusal(
      cancelOrderAsBuyer({ orderId, nonce: 'guess' }),
    );
    const absent = await refusal(
      cancelOrderAsBuyer({ orderId: 'nope', nonce: NONCE }),
    );

    expect([wrong.code, absent.code]).toEqual([
      'cancelNotAuthorized',
      'cancelNotAuthorized',
    ]);
  });

  it('asks a buyer to wait out a payment, and refuses an order past cancelling', async () => {
    const pending = world();
    const dispatched = world();
    const pendingId = await pending.placed('pending');
    const dispatchedId = await dispatched.placed('confirmed');
    await dispatched.run(
      dispatched.stores.orders.move(dispatchedId, 'mark-dispatched', undefined),
    );

    expect(
      (
        await pending.refusal(
          cancelOrderAsBuyer({ orderId: pendingId, nonce: NONCE }),
        )
      ).code,
    ).toBe('paymentPending');
    expect(
      (
        await dispatched.refusal(
          cancelOrderAsBuyer({ orderId: dispatchedId, nonce: NONCE }),
        )
      ).code,
    ).toBe('orderNotCancellable');
  });
});

describe('buyerReceipt', () => {
  it('reads the group and its vendor orders back by the capability', async () => {
    const { run, refusal, placed } = world();
    const orderId = await placed();

    const receipt = await run(buyerReceipt({ groupId: GROUP, nonce: NONCE }));
    const guessed = await refusal(buyerReceipt({ groupId: GROUP, nonce: 'x' }));
    const unknown = await refusal(
      buyerReceipt({ groupId: crypto.randomUUID(), nonce: NONCE }),
    );

    expect(receipt.group.id).toBe(GROUP);
    expect(receipt.orders.map(order => order.id)).toEqual([orderId]);
    expect([guessed.code, unknown.code]).toEqual([
      'cancelNotAuthorized',
      'cancelNotAuthorized',
    ]);
  });
});
