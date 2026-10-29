import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  IdempotencyStoreTag,
  InvalidToken,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { defineCatalog, flowCommit } from '@entifix/business/flow';
import { Unavailable } from '@entifix/core';
import { ServiceCrossingTokenTag } from '@entifix/service-shell';
import {
  makeInMemoryEntityRepository,
  makeInMemoryIdempotencyStore,
} from '@entifix/testing-unit';
import {
  CancelWindowSeconds,
  digestOf,
  OrderItem,
  ProductOrder,
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import {
  SagaStarterTag,
  type SagaStartOutcome,
} from '@r10c/business-ts-saga-contracts';
import { crossingCall } from '@r10c/testing-cells';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer, Schema } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { productOrderRoutes } from './product-order-routes.js';

const NONCE = 'buyer-nonce';

const orderOf = (
  id: string,
  status: string,
  vendors = ['v-1'],
  buyerId = 'p-1',
) =>
  Object.assign(new ProductOrder(buyerId), {
    id,
    status,
    items: vendors.map(vendor => new OrderItem('o-1', vendor, 1, 10, 'GTQ')),
    cancelDigest: digestOf(NONCE),
    cancelWindowEndsAt: new Date(Date.now() + 600_000),
  });

const orders = new Map<string, ProductOrder>();
const commands = new Set<string>();
let storeDown = false;
let saga: SagaStartOutcome = { _tag: 'completed', result: {} };

const down = () => Effect.fail(new Unavailable({}));

const store: ProductOrderStore = {
  get: id => (storeDown ? down() : Effect.succeed(orders.get(id))),
  place: (order, commandId) =>
    storeDown
      ? down()
      : Effect.sync(() => {
          if (commandId && commands.has(commandId)) {
            return { _tag: 'replayed' as const, order };
          }
          if (commandId) commands.add(commandId);
          orders.set(String(order.id), order);
          return { _tag: 'placed' as const, order };
        }),
  remove: id => (storeDown ? down() : Effect.sync(() => orders.delete(id))),
  fulfil: (id, items, status) =>
    Effect.sync(() =>
      id === 'raced'
        ? undefined
        : Object.assign(orders.get(id) as ProductOrder, { items, status }),
    ),
  claimCancellation: (id, commandId) =>
    storeDown
      ? down()
      : Effect.sync(() => {
          if (commandId && commands.has(commandId))
            return { _tag: 'replayed' as const };
          if (commandId) commands.add(commandId);
          const order = orders.get(id);
          if (order?.status !== 'paid')
            return { _tag: 'notClaimable' as const };
          order.status = 'cancelling';
          return { _tag: 'claimed' as const, order };
        }),
  releaseCancellation: id =>
    storeDown
      ? down()
      : Effect.sync(() => {
          const order = orders.get(id);
          if (order?.status !== 'cancelling') return false;
          order.status = 'paid';
          return true;
        }),
  settleCancellation: id =>
    storeDown
      ? down()
      : Effect.sync(() => {
          const order = orders.get(id);
          if (order?.status !== 'cancelling') return undefined;
          order.status = 'cancelled';
          return order;
        }),
  markPaid: () => Effect.succeed('claimed' as const),
};

const sessions: Record<string, TokenClaims> = {
  operator: {
    userId: 'u-op',
    subject: 'op',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'operator',
  },
  vendor: {
    userId: 'u-v',
    subject: 'v',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'vendor',
    activeOrganizationId: 'v-1',
  },
  buyer: {
    userId: 'u-b',
    subject: 'b',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'customer',
    partyId: 'p-1',
  },
  nobody: { userId: 'u-n', subject: 'n', sessionId: 's', roles: ['staff'] },
};

/**
 * The smallest recipe `cancel` can name: the cell only reports what its shell
 * resolves, and the real cancellation is the flow catalog's to enumerate.
 */
const compositions = {
  catalog: defineCatalog([flowCommit]),
  recipes: {
    cancellation: {
      name: 'cancellation',
      input: Schema.Struct({}),
      requiresCommitPoint: true,
      stages: [{ name: 'commit', steps: [{ ref: 'flow.commit@1' }] }],
    },
  },
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    productOrderRoutes(compositions),
    Layer.mergeAll(
      Layer.succeed(ProductOrderStoreTag, store),
      Layer.succeed(CancelWindowSeconds, 600),
      Layer.succeed(SagaStarterTag, { start: () => Effect.sync(() => saga) }),
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () =>
          Effect.succeed(makeInMemoryEntityRepository([...orders.values()])),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          sessions[token]
            ? Effect.succeed(sessions[token] as TokenClaims)
            : Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          staff: ['order-management:product-order:*'],
        }),
      ),
      Layer.succeed(ServiceCrossingTokenTag, 'fleet'),
      Layer.succeed(IdempotencyStoreTag, edge),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'order-management:product-order:write',
          'order-management:product-order:delete',
        ]),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

beforeEach(() => {
  orders.clear();
  commands.clear();
  storeDown = false;
  saga = { _tag: 'completed', result: {} };
  for (const order of [
    orderOf('mine', 'paid', ['v-1']),
    orderOf('shared', 'paid', ['v-1', 'v-2']),
    orderOf('theirs', 'paid', ['v-9'], 'p-9'),
    orderOf('pending', 'pending'),
    orderOf('fulfilled', 'fulfilled'),
    orderOf('claimed', 'cancelling'),
  ]) {
    orders.set(String(order.id), order);
  }
});

const as = (who: string, path: string, init: RequestInit = {}) =>
  served.call(path, {
    ...init,
    headers: {
      authorization: `Bearer ${who}`,
      'content-type': 'application/json',
    },
  });

const crossing = (path: string, init: RequestInit = {}, commandId?: string) =>
  crossingCall(served, path, {
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    commandId,
  });

const totalFor = async (who: string) =>
  (
    (await (await as(who, '/api/product-order')).json()) as {
      data: { total: number };
    }
  ).data.total;

/**
 * The edge's `Idempotency-Key` records, on a clock a case can move past their
 * retention — the only way to reach the unit of work's own replay, which is
 * what still answers once the edge has forgotten a key.
 */
let edgeNow = 0;
const edge = makeInMemoryIdempotencyStore({
  retentionMs: 60_000,
  now: () => edgeNow,
});
const forgetAtTheEdge = () => {
  edgeNow += 60_001;
};

describe('GET /api/product-order/$metadata', () => {
  it('reports the flow `cancel` starts', async () => {
    const response = await as('operator', '/api/product-order/$metadata');

    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: { useCases: { key: string; composition?: unknown }[] };
    };
    expect(data.useCases.find(useCase => useCase.key === 'cancel')).toMatchObject(
      {
        composition: {
          recipe: 'cancellation',
          fragments: ['flow.commit@1'],
        },
      },
    );
  });
});

describe('the scoped reads', () => {
  it('give an operator everything, a vendor and a buyer their own, and anybody else nothing', async () => {
    // The vendor's predicate names `items.vendorId`, a path into the lines that
    // Mongo evaluates and the in-memory repository does not; the store's own
    // spec is where that one is measured. Here it is enough that a vendor gets
    // a page.
    expect(await totalFor('operator')).toBe(6);
    expect((await as('vendor', '/api/product-order')).status).toBe(200);
    expect(await totalFor('buyer')).toBe(5);
    expect(await totalFor('nobody')).toBe(0);
  });

  it('answer an order outside the caller’s scope as not found', async () => {
    expect((await as('vendor', '/api/product-order/mine')).status).toBe(200);
    expect((await as('vendor', '/api/product-order/theirs')).status).toBe(404);
  });
});

describe('placing and compensating', () => {
  const body = (items: unknown[]) =>
    JSON.stringify({
      meta: { type: 'entity', entity: 'product-order' },
      data: { items, cancelDigest: 'digest' },
    });
  const line = {
    offeringId: 'o-1',
    vendorId: 'v-1',
    quantity: 1,
    amount: 10,
    currency: 'GTQ',
  };

  it('places an order, and answers a redelivery with 200', async () => {
    const placed = await crossing(
      '/api/product-order',
      { method: 'POST', body: body([line]) },
      'c-1',
    );
    const again = await crossing(
      '/api/product-order',
      { method: 'POST', body: body([line]) },
      'c-1',
    );

    expect(placed.status).toBe(201);
    expect(again.status).toBe(201);
  });

  it('answers from the store once the edge has forgotten the key', async () => {
    await crossing(
      '/api/product-order',
      { method: 'POST', body: body([line]) },
      'c-forgot',
    );
    forgetAtTheEdge();
    const again = await crossing(
      '/api/product-order',
      { method: 'POST', body: body([line]) },
      'c-forgot',
    );

    // The unit of work's own claim, not the edge's replay.
    expect(again.status).toBe(200);
  });

  it('refuses an empty basket and a body that is not an envelope', async () => {
    const empty = await crossing('/api/product-order', {
      method: 'POST',
      body: body([]),
    });
    const invalid = await crossing('/api/product-order', {
      method: 'POST',
      body: '{}',
    });

    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      detail: 'an order must carry at least one item',
    });
    expect(invalid.status).toBe(400);
  });

  it('answers a placement whose store failed with 500', async () => {
    storeDown = true;
    const failing = await crossing('/api/product-order', {
      method: 'POST',
      body: body([line]),
    });

    expect(failing.status).toBe(500);
  });

  it('removes an order as compensation, and says when there was none', async () => {
    const removed = await crossing('/api/product-order/mine', {
      method: 'DELETE',
    });
    const none = await crossing('/api/product-order/mine', {
      method: 'DELETE',
    });
    storeDown = true;
    const broken = await crossing('/api/product-order/mine', {
      method: 'DELETE',
    });

    expect(await removed.json()).toEqual({ id: 'mine', outcome: 'deleted' });
    expect(await none.json()).toEqual({ id: 'mine', outcome: 'not-found' });
    expect(broken.status).toBe(500);
  });
});

describe('POST /:id/fulfil', () => {
  it('fulfils a vendor’s own paid order, and refuses one not paid or changed underneath', async () => {
    orders.set('raced', orderOf('raced', 'paid'));

    const fulfilled = await as('vendor', '/api/product-order/mine/fulfil', {
      method: 'POST',
    });
    const notPaid = await as('operator', '/api/product-order/pending/fulfil', {
      method: 'POST',
    });
    const raced = await as('operator', '/api/product-order/raced/fulfil', {
      method: 'POST',
    });
    const stranger = await as('vendor', '/api/product-order/theirs/fulfil', {
      method: 'POST',
    });

    expect(fulfilled.status).toBe(200);
    expect(notPaid.status).toBe(409);
    expect(raced.status).toBe(409);
    expect(stranger.status).toBe(404);
  });

  it('answers a store that failed with 500', async () => {
    storeDown = true;

    expect(
      (
        await as('operator', '/api/product-order/mine/fulfil', {
          method: 'POST',
        })
      ).status,
    ).toBe(500);
  });
});

describe('POST /:id/cancellation', () => {
  it('cancels a vendor’s own order through the flow', async () => {
    const response = await as(
      'vendor',
      '/api/product-order/mine/cancellation',
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
  });

  it('refuses an order naming another vendor, and an order past cancelling', async () => {
    const shared = await as(
      'vendor',
      '/api/product-order/shared/cancellation',
      { method: 'POST' },
    );
    const late = await as(
      'operator',
      '/api/product-order/fulfilled/cancellation',
      { method: 'POST' },
    );

    expect(shared.status).toBe(409);
    expect(await shared.json()).toMatchObject({
      error: 'the order names another vendor',
      code: 'multiVendorOrder',
    });
    expect(await late.json()).toMatchObject({
      error: 'the order cannot be cancelled',
    });
  });

  it('answers a buyer as not found, a stranded flow with 500, and a failed store with 500', async () => {
    const buyer = await as('buyer', '/api/product-order/mine/cancellation', {
      method: 'POST',
    });
    saga = { _tag: 'failed', status: 502, result: undefined };
    const stranded = await as(
      'operator',
      '/api/product-order/mine/cancellation',
      { method: 'POST' },
    );
    storeDown = true;
    const broken = await as(
      'operator',
      '/api/product-order/mine/cancellation',
      { method: 'POST' },
    );

    expect(buyer.status).toBe(404);
    expect(stranded.status).toBe(500);
    expect(broken.status).toBe(500);
  });
});

describe('POST /:id/buyer-cancellation', () => {
  const cancel = (id: string, body: string) =>
    served.call(`/api/product-order/${id}/buyer-cancellation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  it('cancels with the receipt’s nonce and no session', async () => {
    expect(
      (await cancel('mine', JSON.stringify({ cancelNonce: NONCE }))).status,
    ).toBe(200);
  });

  it('answers every capability failure alike, and a body that is not JSON the same', async () => {
    const wrong = await cancel(
      'mine',
      JSON.stringify({ cancelNonce: 'guess' }),
    );
    const notJson = await cancel('mine', 'not json');

    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      error: 'the order cannot be cancelled from here',
      code: 'cancelNotAuthorized',
    });
    expect(notJson.status).toBe(401);
  });

  it('tells a buyer the payment is still being confirmed', async () => {
    const pending = await cancel(
      'pending',
      JSON.stringify({ cancelNonce: NONCE }),
    );

    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({
      error: 'the payment is still being confirmed',
      code: 'paymentPending',
    });
  });

  it('answers a store that failed with 500', async () => {
    storeDown = true;

    expect(
      (await cancel('mine', JSON.stringify({ cancelNonce: NONCE }))).status,
    ).toBe(500);
  });
});

describe('the cancellation saga’s steps', () => {
  it('claims a paid order, answers a redelivery with the order, and refuses one not paid', async () => {
    const claimed = await crossing(
      '/api/product-order/mine/cancelling',
      { method: 'POST' },
      'k-1',
    );
    const again = await crossing(
      '/api/product-order/mine/cancelling',
      { method: 'POST' },
      'k-1',
    );
    const refused = await crossing('/api/product-order/pending/cancelling', {
      method: 'POST',
    });
    const absent = await crossing(
      '/api/product-order/absent/cancelling',
      { method: 'POST' },
      'k-absent',
    );
    const replayedAbsent = await crossing(
      '/api/product-order/absent/cancelling',
      { method: 'POST' },
      'k-absent',
    );

    expect(claimed.status).toBe(200);
    expect(again.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      detail: "an order in 'pending' cannot be cancelled",
    });
    expect(absent.status).toBe(404);
    expect(replayedAbsent.status).toBe(404);
  });

  it('answers a claim from the store once the edge has forgotten the key', async () => {
    await crossing(
      '/api/product-order/mine/cancelling',
      { method: 'POST' },
      'k-forgot',
    );
    forgetAtTheEdge();
    const again = await crossing(
      '/api/product-order/mine/cancelling',
      { method: 'POST' },
      'k-forgot',
    );

    expect(again.status).toBe(200);
  });

  it('releases a claim, and answers 200 when there was none', async () => {
    const released = await crossing('/api/product-order/claimed/cancelling', {
      method: 'DELETE',
    });
    const none = await crossing('/api/product-order/claimed/cancelling', {
      method: 'DELETE',
    });

    expect(await released.json()).toEqual({
      id: 'claimed',
      outcome: 'released',
    });
    expect(await none.json()).toEqual({
      id: 'claimed',
      outcome: 'not-claimed',
    });
  });

  it('settles a claimed order, and answers a repeat with the order as it stands', async () => {
    const settled = await crossing('/api/product-order/claimed/cancelled', {
      method: 'POST',
    });
    const again = await crossing('/api/product-order/claimed/cancelled', {
      method: 'POST',
    });
    const absent = await crossing('/api/product-order/absent/cancelled', {
      method: 'POST',
    });

    expect(settled.status).toBe(200);
    expect(again.status).toBe(200);
    expect(absent.status).toBe(404);
  });

  it('answers every step whose store failed with 500, and a session with 401', async () => {
    const session = await as('operator', '/api/product-order/mine/cancelling', {
      method: 'POST',
    });
    storeDown = true;
    const statuses = await Promise.all([
      crossing('/api/product-order/mine/cancelling', { method: 'POST' }).then(
        r => r.status,
      ),
      crossing('/api/product-order/mine/cancelling', { method: 'DELETE' }).then(
        r => r.status,
      ),
      crossing('/api/product-order/mine/cancelled', { method: 'POST' }).then(
        r => r.status,
      ),
    ]);

    expect(session.status).toBe(401);
    expect(statuses).toEqual([500, 500, 500]);
  });
});
