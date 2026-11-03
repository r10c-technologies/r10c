import { isStoreFault } from '@entifix/core';
import {
  COMMAND_INBOX_COLLECTION,
  OUTBOX_COLLECTION,
} from '@entifix/mongo/transactions';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  CheckoutGroup,
  CheckoutGroupStoreTag,
  OrderItem,
  ProductOrder,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import {
  describeProductOrderStoreContract,
  type OrderStores,
} from '@r10c/business-ts-order-management/testing';
import { mongoCellWorld } from '@r10c/testing-cells/mongo';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  GROUP_COLLECTION,
  MongoOrderStoresLayer,
  ORDER_COLLECTION,
} from './product-order-store.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const world = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const cell = mongoCellWorld(MongoOrderStoresLayer, { source: 'order', seed });
  const run = <A, E>(use: (stores: OrderStores) => Effect.Effect<A, E>) =>
    cell.run(
      Effect.flatMap(
        Effect.all({
          orders: ProductOrderStoreTag,
          groups: CheckoutGroupStoreTag,
        }),
        use,
      ),
    );
  return { fake: cell.fake, bus: cell.bus, run };
};

describeProductOrderStoreContract('the Mongo stores', () =>
  world().run(stores => Effect.succeed(stores)),
);

const GROUP = 'grp-1';

const aGroup = () =>
  Object.assign(new CheckoutGroup(), { id: GROUP, buyerId: 'buyer-1' });

const anOrder = (id: string) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    vendorId: 'v-1',
    groupId: GROUP,
    paymentMethod: 'card',
    status: 'pending',
    items: [new OrderItem('o-1', 2, 10, 'GTQ')],
  });

const eventsOf = (fake: Fake) =>
  fake
    .read(OUTBOX_COLLECTION)
    .map(entry => entry['event'] as { name: string; audience: unknown });

const statusOf = (fake: Fake, id: string) =>
  fake.read(ORDER_COLLECTION).find(doc => doc['id'] === id)?.['status'];

/** A group with one pending order in it. */
const placed = async (run: ReturnType<typeof world>['run']) => {
  await run(({ groups }) => groups.open(aGroup(), undefined));
  await run(({ orders }) => orders.place(anOrder('ord-1'), undefined));
};

describe('placing an order', () => {
  it('writes it, announces order.placed to its buyer and its one vendor, and drains it', async () => {
    const { fake, bus, run } = world();

    await placed(run);

    expect(statusOf(fake, 'ord-1')).toBe('pending');
    expect(eventsOf(fake)).toEqual([
      expect.objectContaining({
        name: 'order.placed',
        audience: [
          { kind: 'party', id: 'buyer-1' },
          { kind: 'organization', id: 'v-1' },
        ],
      }),
    ]);
    expect(bus.published.map(event => event.name)).toEqual(['order.placed']);
  });

  it('refuses a duplicate that remembers no order, and a group duplicate that remembers none', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-ghost', claimedAt: 'then' },
        { commandId: 'g-ghost', claimedAt: 'then' },
      ],
      [GROUP_COLLECTION]: [{ id: GROUP }],
    });

    const order = await run(({ orders }) =>
      Effect.flip(orders.place(anOrder('ord-1'), 'c-ghost')),
    );
    const group = await run(({ groups }) =>
      Effect.flip(groups.open(aGroup(), 'g-ghost')),
    );

    expect(isStoreFault(order)).toBe(true);
    expect(isStoreFault(group)).toBe(true);
  });

  it('reports writes and reads the driver failed as store failures', async () => {
    const writes = world();
    await writes.run(({ groups }) => groups.open(aGroup(), undefined));
    writes.fake.failOn('insertOne', new Error('disk full'));
    const reads = world();
    reads.fake.failOn('findOne', new Error('network down'));
    const lists = world();
    lists.fake.failOn('find', new Error('network down'));

    const write = await writes.run(({ orders }) =>
      Effect.flip(orders.place(anOrder('ord-1'), undefined)),
    );
    const open = await writes.run(({ groups }) =>
      Effect.flip(groups.open(aGroup(), undefined)),
    );
    const read = await reads.run(({ orders }) => Effect.flip(orders.get('x')));
    const group = await reads.run(({ groups }) => Effect.flip(groups.get('x')));
    const placeFails = world();
    placeFails.fake.failOn('updateOne', new Error('network down'));
    const place = await placeFails.run(({ orders }) =>
      Effect.flip(orders.place(anOrder('ord-1'), undefined)),
    );
    const list = await lists.run(({ orders }) =>
      Effect.flip(orders.forGroup(GROUP)),
    );

    for (const failure of [write, open, read, group, place, list]) {
      expect(isStoreFault(failure)).toBe(true);
    }
  });

  it('reports a stored record that will not read back as a store failure', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-bad', claimedAt: 'then', replay: { record: 'nope' } },
        { commandId: 'g-bad', claimedAt: 'then', replay: { record: 'nope' } },
      ],
      [GROUP_COLLECTION]: [{ id: GROUP }],
    });

    const order = await run(({ orders }) =>
      Effect.flip(orders.place(anOrder('ord-z'), 'c-bad')),
    );
    const group = await run(({ groups }) =>
      Effect.flip(groups.open(aGroup(), 'g-bad')),
    );

    expect(isStoreFault(order)).toBe(true);
    expect(isStoreFault(group)).toBe(true);
  });
});

describe('moving an order', () => {
  it('announces order.cancelled when a dispatched parcel is closed cancelled', async () => {
    const { fake, run } = world();
    await placed(run);

    await run(({ orders }) => orders.move('ord-1', 'confirm', undefined));
    await run(({ orders }) =>
      orders.move('ord-1', 'mark-dispatched', undefined),
    );
    const closed = await run(({ orders }) =>
      orders.move('ord-1', 'close-cancelled', 'cmd-1'),
    );

    expect(closed?.status).toBe('cancelled');
    expect(eventsOf(fake).map(event => event.name)).toEqual([
      'order.placed',
      'order.cancelled',
    ]);
  });

  it('reports a move the driver failed as a store failure', async () => {
    const { fake, run } = world();
    await placed(run);
    fake.failOn('findOneAndUpdate', new Error('network down'));

    const error = await run(({ orders }) =>
      Effect.flip(orders.move('ord-1', 'confirm', undefined)),
    );

    expect(isStoreFault(error)).toBe(true);
  });
});

describe('a cancellation', () => {
  it('releases a claim from a confirmed order back to confirmed', async () => {
    const { fake, run } = world();
    await placed(run);
    await run(({ orders }) => orders.move('ord-1', 'confirm', undefined));
    await run(({ orders }) => orders.claimCancellation('ord-1', undefined));

    expect(await run(({ orders }) => orders.releaseCancellation('ord-1'))).toBe(
      true,
    );
    expect(statusOf(fake, 'ord-1')).toBe('confirmed');
  });

  it('settles a claimed order, announcing order.cancelled', async () => {
    const { fake, run } = world();
    await placed(run);
    await run(({ orders }) =>
      orders.markPaid(
        { consumer: 'c', eventId: 'e' },
        'ord-1',
        '2026-10-26T10:00:00.000Z',
      ),
    );
    await run(({ orders }) => orders.claimCancellation('ord-1', undefined));

    await run(({ orders }) => orders.settleCancellation('ord-1', 's-1'));

    expect(statusOf(fake, 'ord-1')).toBe('cancelled');
    expect(eventsOf(fake).map(event => event.name)).toContain(
      'order.cancelled',
    );
  });

  it('reports a release, a removal and a group removal the driver failed as store failures', async () => {
    const { fake, run } = world();
    await placed(run);
    fake.failOn('updateOne', new Error('network down'));
    fake.failOn('deleteOne', new Error('network down'));

    const release = await run(({ orders }) =>
      Effect.flip(orders.releaseCancellation('ord-1')),
    );
    const remove = await run(({ orders }) =>
      Effect.flip(orders.remove('ord-1')),
    );
    const group = await run(({ groups }) => Effect.flip(groups.remove(GROUP)));

    for (const failure of [release, remove, group]) {
      expect(isStoreFault(failure)).toBe(true);
    }
  });
});

describe('MongoOrderStoresLayer', () => {
  it('fails to build when its indexes cannot be ensured', async () => {
    const { fake, run } = world();
    fake.failOn('createIndex', new Error('not primary'));

    await expect(run(() => Effect.void)).rejects.toThrow();
  });
});
