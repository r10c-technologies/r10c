import { type EntityApiContext, IdempotencyKeyTag } from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
import {
  CancelWindowSeconds,
  digestOf,
  OrderItem,
  ProductOrder,
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { makeInMemoryProductOrderStore } from '@r10c/business-ts-order-management/testing';
import { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { makeScriptedSagaStarter } from '@r10c/business-ts-saga-contracts/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { productOrderApi, productOrderEndpoints } from './product-order-api.js';

const operator: EntityApiContext = {
  principal: { partyRole: 'operator' } as EntityApiContext['principal'],
  links: {
    record: id => [{ rel: 'self', href: `/api/product-order/${String(id)}` }],
    collection: () => [],
  },
};
const anonymous: EntityApiContext = { links: operator.links };

const orderOf = (
  id: string,
  status: ProductOrder['status'],
  extra: Partial<ProductOrder> = {},
) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    status,
    items: [new OrderItem('offering-1', 'v-1', 1, 10, 'GTQ')],
    ...extra,
  });

/**
 * One store per case, seeded with `orders`; the coordinator completes every
 * flow by writing `cancelled` the way the cancellation's last step does.
 */
const world = (orders: ProductOrder[] = []) => {
  const store: ProductOrderStore = makeInMemoryProductOrderStore();
  for (const order of orders) Effect.runSync(store.place(order, undefined));
  const sagas = makeScriptedSagaStarter(definition => {
    if (definition !== 'cancellation') return undefined;
    return { status: 201, body: {} };
  });
  const layer = Layer.mergeAll(
    Layer.succeed(ProductOrderStoreTag, store),
    Layer.succeed(SagaStarterTag, sagas),
    Layer.succeed(CancelWindowSeconds, 60),
  );
  type R = ProductOrderStoreTag | SagaStarterTag | CancelWindowSeconds;
  return {
    store,
    run: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.provide(effect, layer)),
    refusal: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.flip(Effect.provide(effect, layer))),
  };
};

const keyed = <A, E, R>(effect: Effect.Effect<A, E, R>, key: string) =>
  Effect.provideService(effect, IdempotencyKeyTag, key);

const { override, useCases } = productOrderApi.options;
const [fulfil, cancel] = useCases;
const [buyerCancellation, claim, release, settle] = productOrderEndpoints;

const place = (order: ProductOrder) =>
  override.create.handler(
    { payload: makeEntityEnvelope(ProductOrder, order) },
    operator,
  );

describe('the product-order declaration', () => {
  it('reads behind the grant and writes only by crossing', () => {
    expect(productOrderApi.options.guard).toEqual({
      read: { kind: 'permission' },
      write: { kind: 'crossing', organization: false },
    });
    expect(override.create.idempotent).toBe('unit');
    expect(override.delete.idempotent).toBe('edge');
  });

  it('serves fulfil and cancel as the verbs their use cases declare, behind a session', () => {
    expect(useCases.map(verb => [verb.useCase.key, verb.guard])).toEqual([
      ['fulfil', { kind: 'permission' }],
      ['cancel', { kind: 'permission' }],
    ]);
  });
});

describe('placing and compensating', () => {
  it('places an order, and answers a redelivered command with the same one', async () => {
    const { run } = world();
    const order = orderOf('ignored', 'paid', { cancelDigest: 'digest' });

    const first = await run(keyed(place(order), 'cmd-1'));
    const again = await run(keyed(place(order), 'cmd-1'));

    expect(first).toMatchObject({ data: { status: 'pending' } });
    expect(first.data.id).not.toBe('ignored');
    expect(again.data.id).toBe(first.data.id);
  });

  it('refuses an order with no items as an invalid body', async () => {
    const { refusal } = world();

    expect(
      await refusal(place(orderOf('o', 'pending', { items: [] }))),
    ).toMatchObject({ code: 'invalidBody' });
  });

  it('removes an order, and says so when there was none', async () => {
    const { run } = world([orderOf('o-1', 'pending')]);
    const remove = (id: string) => override.delete.handler({ params: { id } });

    expect(await run(remove('o-1'))).toEqual({ id: 'o-1', outcome: 'deleted' });
    expect(await run(remove('o-1'))).toEqual({
      id: 'o-1',
      outcome: 'not-found',
    });
  });
});

describe('the staff verbs', () => {
  it('fulfils a paid order and cancels another, answering each with its record', async () => {
    const { run } = world([orderOf('o-1', 'paid'), orderOf('o-2', 'paid')]);

    const fulfilled = await run(
      fulfil.handler({ params: { id: 'o-1' } }, operator),
    );
    const cancelled = await run(
      cancel.handler({ params: { id: 'o-2' } }, operator),
    );

    expect(fulfilled).toMatchObject({
      meta: { links: [{ rel: 'self', href: '/api/product-order/o-1' }] },
      data: { id: 'o-1', status: 'fulfilled' },
    });
    expect(cancelled).toMatchObject({ data: { id: 'o-2' } });
  });

  it('answers a caller with no principal as if the order did not exist', async () => {
    const { refusal } = world([orderOf('o-1', 'paid')]);

    expect(
      await refusal(fulfil.handler({ params: { id: 'o-1' } }, anonymous)),
    ).toMatchObject({ code: 'notFound' });
    expect(
      await refusal(cancel.handler({ params: { id: 'o-1' } }, anonymous)),
    ).toMatchObject({ code: 'notFound' });
  });
});

describe("a buyer's cancellation", () => {
  const nonce = 'the-buyers-nonce';
  const open = {
    cancelDigest: digestOf(nonce),
    cancelWindowEndsAt: new Date(Date.now() + 60_000),
  };

  it('cancels with the nonce the receipt carried', async () => {
    const { run } = world([orderOf('o-1', 'paid', open)]);

    expect(
      await run(
        buyerCancellation.handler({
          params: { id: 'o-1' },
          payload: { cancelNonce: nonce },
        }),
      ),
    ).toMatchObject({ data: { id: 'o-1' } });
  });

  it('answers a body that carries no nonce as every other capability failure', async () => {
    const { refusal } = world([orderOf('o-1', 'paid', open)]);

    expect(
      await refusal(
        buyerCancellation.handler({
          params: { id: 'o-1' },
          payload: { cancelNonce: 42 },
        }),
      ),
    ).toMatchObject({ code: 'cancelNotAuthorized' });
  });
});

describe('the cancellation saga’s order steps', () => {
  it('claims a paid order once, and answers a redelivered claim with the record', async () => {
    const { run } = world([orderOf('o-1', 'paid')]);

    const claimed = await run(
      keyed(claim.handler({ params: { id: 'o-1' } }), 'claim-1'),
    );
    const replayed = await run(
      keyed(claim.handler({ params: { id: 'o-1' } }), 'claim-1'),
    );

    expect(claimed).toMatchObject({ data: { status: 'cancelling' } });
    expect(replayed).toMatchObject({ data: { status: 'cancelling' } });
  });

  it('refuses a claim on an order past cancelling, and on one that is gone', async () => {
    const { refusal } = world([orderOf('o-1', 'fulfilled')]);

    expect(
      await refusal(claim.handler({ params: { id: 'o-1' } })),
    ).toMatchObject({
      code: 'orderNotCancellable',
      reason: "an order in 'fulfilled' cannot be cancelled",
    });
    expect(
      await refusal(claim.handler({ params: { id: 'o-404' } })),
    ).toMatchObject({ code: 'notFound' });
  });

  it('releases a claim, and answers 200 when there was none', async () => {
    const { run } = world([orderOf('o-1', 'paid')]);
    await run(claim.handler({ params: { id: 'o-1' } }));

    expect(await run(release.handler({ params: { id: 'o-1' } }))).toEqual({
      id: 'o-1',
      outcome: 'released',
    });
    expect(await run(release.handler({ params: { id: 'o-1' } }))).toEqual({
      id: 'o-1',
      outcome: 'not-claimed',
    });
  });

  it('settles a claimed order, answers a redelivery with the record, and refuses one that is gone', async () => {
    const { run, refusal } = world([orderOf('o-1', 'paid')]);
    await run(claim.handler({ params: { id: 'o-1' } }));

    const settled = await run(
      keyed(settle.handler({ params: { id: 'o-1' } }), 'settle-1'),
    );
    const replayed = await run(
      keyed(settle.handler({ params: { id: 'o-1' } }), 'settle-1'),
    );

    expect(settled).toMatchObject({ data: { status: 'cancelled' } });
    expect(replayed).toMatchObject({ data: { status: 'cancelled' } });
    expect(
      await refusal(settle.handler({ params: { id: 'o-404' } })),
    ).toMatchObject({ code: 'notFound' });
  });
});
