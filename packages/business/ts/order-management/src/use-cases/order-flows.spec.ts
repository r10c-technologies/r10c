import {
  SagaStarterTag,
  type SagaStartOutcome,
} from '@r10c/business-ts-saga-contracts';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../entities/product-order/index.js';
import {
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '../ports/product-order-store.js';
import { digestOf } from '../values/cancel-capability.js';
import { OrderItem } from '../values/order-item.js';
import type { OrderScope } from '../values/order-scope.js';
import {
  CANCELLATION_SAGA,
  cancelOrderAsBuyer,
  cancelOrderAsStaff,
  fulfilOrder,
  isMultiVendorRefusal,
  OrderRefused,
  placeOrder,
} from './order-flows.js';

const orderOf = (
  id: string,
  status: ProductOrder['status'],
  vendors: string[] = ['v-1'],
  extra: Partial<ProductOrder> = {},
) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    status,
    items: vendors.map(vendor => new OrderItem('o-1', vendor, 1, 10, 'GTQ')),
    ...extra,
  });

/** A store over a map, and a record of every flow started on its behalf. */
const world = (
  orders: ProductOrder[] = [],
  saga: SagaStartOutcome = { _tag: 'completed', result: {} },
  fulfilChanges = false,
) => {
  const byId = new Map(orders.map(order => [String(order.id), order]));
  const started: Array<{ definition: string; inputs: unknown }> = [];
  const store: ProductOrderStore = {
    get: id => Effect.succeed(byId.get(id)),
    place: order =>
      Effect.sync(() => {
        byId.set(String(order.id), order);
        return { _tag: 'placed' as const, order };
      }),
    remove: () => Effect.succeed(true),
    fulfil: (id, items, status) =>
      Effect.sync(() => {
        if (fulfilChanges) return undefined;
        const order = byId.get(id) as ProductOrder;
        return Object.assign(order, { items, status });
      }),
    claimCancellation: () => Effect.succeed({ _tag: 'notClaimable' as const }),
    releaseCancellation: () => Effect.succeed(false),
    settleCancellation: () => Effect.succeed(undefined),
    markPaid: () => Effect.succeed('claimed' as const),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(ProductOrderStoreTag, store),
    Layer.succeed(SagaStarterTag, {
      start: (definition, inputs) =>
        Effect.sync(() => {
          started.push({ definition, inputs });
          return saga;
        }),
    }),
  );
  const run = <A, E>(
    effect: Effect.Effect<A, E, ProductOrderStoreTag | SagaStarterTag>,
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { run, started, byId };
};

const operator: OrderScope = { kind: 'unscoped' };
const vendor = (organizationId: string): OrderScope => ({
  kind: 'vendor',
  organizationId,
});

describe('placeOrder', () => {
  it('stamps the id, the status and the placing time, and opens the cancel window only with a digest', async () => {
    const { run } = world();

    const online = await run(
      placeOrder({
        order: orderOf('ignored', 'paid', ['v-1'], { cancelDigest: 'digest' }),
        commandId: 'c-1',
        cancelWindowSeconds: 60,
      }),
    );
    const counter = await run(
      placeOrder({
        order: orderOf('ignored', 'paid'),
        commandId: undefined,
        cancelWindowSeconds: 60,
      }),
    );

    expect(online.order.id).not.toBe('ignored');
    expect(online.order.status).toBe('pending');
    expect(
      (online.order.cancelWindowEndsAt as Date).getTime() -
        (online.order.placedAt as Date).getTime(),
    ).toBe(60_000);
    expect(counter.order.cancelWindowEndsAt).toBeUndefined();
  });

  it('refuses an order with no items', async () => {
    const { run } = world();

    const refused = await run(
      Effect.flip(
        placeOrder({
          order: orderOf('o', 'pending', []),
          commandId: undefined,
          cancelWindowSeconds: 60,
        }),
      ),
    );

    expect(refused).toBeInstanceOf(OrderRefused);
  });
});

describe('fulfilOrder', () => {
  it('stamps the vendor’s own lines on a paid order', async () => {
    const { run } = world([orderOf('o-1', 'paid', ['v-1', 'v-2'])]);

    const result = await run(
      fulfilOrder({ orderId: 'o-1', scope: vendor('v-1') }),
    );

    expect(result._tag).toBe('fulfilled');
  });

  it('answers a buyer, a stranger and an absent order alike, as not found', async () => {
    const { run } = world([orderOf('o-1', 'paid', ['v-1'])]);

    const results = await Promise.all([
      run(
        fulfilOrder({ orderId: 'o-1', scope: { kind: 'buyer', partyId: 'p' } }),
      ),
      run(fulfilOrder({ orderId: 'o-1', scope: { kind: 'nothing' } })),
      run(fulfilOrder({ orderId: 'o-1', scope: vendor('v-9') })),
      run(fulfilOrder({ orderId: 'o-404', scope: operator })),
    ]);

    expect(results.map(result => result._tag)).toEqual([
      'notFound',
      'notFound',
      'notFound',
      'notFound',
    ]);
  });

  it('refuses an order that is not paid, and one that changed underneath', async () => {
    const pending = world([orderOf('o-1', 'pending')]);
    const raced = world([orderOf('o-2', 'paid')], undefined, true);

    const notPaid = await pending.run(
      fulfilOrder({ orderId: 'o-1', scope: operator }),
    );
    const changed = await raced.run(
      fulfilOrder({ orderId: 'o-2', scope: operator }),
    );

    expect(notPaid).toEqual({
      _tag: 'notFulfillable',
      detail: "an order in 'pending' cannot be fulfilled",
    });
    expect(changed).toEqual({
      _tag: 'notFulfillable',
      detail: 'the order changed while it was being fulfilled',
    });
  });
});

describe('cancelOrderAsStaff', () => {
  it('starts the cancellation with each line’s goods going back to its vendor', async () => {
    const { run, started } = world([orderOf('o-1', 'paid', ['v-1'])]);

    const result = await run(
      cancelOrderAsStaff({ orderId: 'o-1', scope: vendor('v-1') }),
    );

    expect(result._tag).toBe('cancelled');
    expect(started[0]?.definition).toBe(CANCELLATION_SAGA);
    expect(started[0]?.inputs).toMatchObject({
      'restore-stock': [{ organizationId: 'v-1' }],
    });
  });

  it('refuses a vendor an order that names another vendor, and an order past cancelling', async () => {
    const { run, started } = world([
      orderOf('o-1', 'paid', ['v-1', 'v-2']),
      orderOf('o-2', 'fulfilled', ['v-1']),
    ]);

    const shared = await run(
      cancelOrderAsStaff({ orderId: 'o-1', scope: vendor('v-1') }),
    );
    const late = await run(
      cancelOrderAsStaff({ orderId: 'o-2', scope: operator }),
    );

    expect(shared).toEqual({ _tag: 'refused', code: 'multiVendorOrder' });
    expect(isMultiVendorRefusal('multiVendorOrder')).toBe(true);
    expect(late).toEqual({ _tag: 'refused', code: 'orderNotCancellable' });
    expect(started).toEqual([]);
  });

  it('answers a buyer, a stranger and an absent order as not found', async () => {
    const { run } = world([orderOf('o-1', 'paid', ['v-1'])]);

    const results = await Promise.all([
      run(
        cancelOrderAsStaff({
          orderId: 'o-1',
          scope: { kind: 'buyer', partyId: 'p' },
        }),
      ),
      run(cancelOrderAsStaff({ orderId: 'o-1', scope: vendor('v-9') })),
      run(cancelOrderAsStaff({ orderId: 'o-404', scope: operator })),
    ]);

    expect(results.map(result => result._tag)).toEqual([
      'notFound',
      'notFound',
      'notFound',
    ]);
  });

  it('names the refund as the refusal when the flow compensated there, and reports a stranded flow', async () => {
    const refundRefused = world([orderOf('o-1', 'paid')], {
      _tag: 'compensated',
      result: {
        data: {
          outcomes: [
            { stepId: 'claim' },
            { stepId: 'refund', error: 'declined' },
          ],
        },
      },
    });
    const otherRefused = world([orderOf('o-2', 'paid')], {
      _tag: 'compensated',
      result: { data: { outcomes: [{ stepId: 'claim', error: 'conflict' }] } },
    });
    const noOutcomes = world([orderOf('o-3', 'paid')], {
      _tag: 'compensated',
      result: undefined,
    });
    const stranded = world([orderOf('o-4', 'paid')], {
      _tag: 'failed',
      status: 502,
      result: undefined,
    });

    expect(
      await refundRefused.run(
        cancelOrderAsStaff({ orderId: 'o-1', scope: operator }),
      ),
    ).toEqual({
      _tag: 'refused',
      code: 'refundDeclined',
    });
    expect(
      await otherRefused.run(
        cancelOrderAsStaff({ orderId: 'o-2', scope: operator }),
      ),
    ).toEqual({
      _tag: 'refused',
      code: 'orderNotCancellable',
    });
    expect(
      await noOutcomes.run(
        cancelOrderAsStaff({ orderId: 'o-3', scope: operator }),
      ),
    ).toEqual({
      _tag: 'refused',
      code: 'orderNotCancellable',
    });
    expect(
      await stranded.run(
        cancelOrderAsStaff({ orderId: 'o-4', scope: operator }),
      ),
    ).toEqual({
      _tag: 'failed',
      status: 502,
    });
  });

  it('answers a cancelled order with the record even when it can no longer be read', async () => {
    const order = orderOf('o-1', 'paid');
    const state = world([order]);
    const result = await state.run(
      Effect.gen(function* () {
        const outcome = yield* cancelOrderAsStaff({
          orderId: 'o-1',
          scope: operator,
        });
        state.byId.delete('o-1');
        return outcome;
      }),
    );
    expect(result._tag).toBe('cancelled');

    const gone = world([order]);
    const flow = await gone.run(
      Effect.gen(function* () {
        const store = yield* ProductOrderStoreTag;
        const sagas = yield* SagaStarterTag;
        return yield* cancelOrderAsStaff({
          orderId: 'o-1',
          scope: operator,
        }).pipe(
          Effect.provideService(ProductOrderStoreTag, {
            ...store,
            get: id =>
              Effect.sync(() => {
                const found = gone.byId.get(id);
                gone.byId.delete(id);
                return found;
              }),
          }),
          Effect.provideService(SagaStarterTag, sagas),
        );
      }),
    );
    expect(flow).toEqual({ _tag: 'cancelled', order });
  });
});

describe('cancelOrderAsBuyer', () => {
  const nonce = 'the-buyers-nonce';
  const open = () => ({
    cancelDigest: digestOf(nonce),
    cancelWindowEndsAt: new Date(Date.now() + 60_000),
  });

  it('starts the cancellation for a buyer holding the capability', async () => {
    const { run } = world([orderOf('o-1', 'paid', ['v-1'], open())]);

    const result = await run(cancelOrderAsBuyer({ orderId: 'o-1', nonce }));

    expect(result._tag).toBe('cancelled');
  });

  it('answers every capability failure alike, and an absent order the same', async () => {
    const { run } = world([orderOf('o-1', 'paid', ['v-1'], open())]);

    const wrong = await run(
      cancelOrderAsBuyer({ orderId: 'o-1', nonce: 'guess' }),
    );
    const absent = await run(cancelOrderAsBuyer({ orderId: 'o-404', nonce }));

    expect(wrong._tag).toBe('notAuthorized');
    expect(absent._tag).toBe('notAuthorized');
  });

  it('tells a buyer the payment is still being confirmed, and refuses an order past cancelling', async () => {
    const { run } = world([
      orderOf('o-1', 'pending', ['v-1'], open()),
      orderOf('o-2', 'fulfilled', ['v-1'], open()),
    ]);

    expect(await run(cancelOrderAsBuyer({ orderId: 'o-1', nonce }))).toEqual({
      _tag: 'refused',
      code: 'paymentPending',
    });
    expect(await run(cancelOrderAsBuyer({ orderId: 'o-2', nonce }))).toEqual({
      _tag: 'refused',
      code: 'orderNotCancellable',
    });
  });
});
