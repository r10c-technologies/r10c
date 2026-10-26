import { EntifixConnError } from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  COMMAND_INBOX_COLLECTION,
  makeMongoUnitOfWork,
  MongoUnitOfWorkTag,
  OUTBOX_COLLECTION,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  OrderItem,
  ProductOrder,
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { describeProductOrderStoreContract } from '@r10c/business-ts-order-management/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  MongoProductOrderStoreLayer,
  ORDER_COLLECTION,
} from './product-order-store.js';

const stored = (id: string, status: string) => ({
  id,
  status,
  buyerId: 'buyer-1',
  items: [
    {
      offeringId: 'o-1',
      vendorId: 'v-1',
      quantity: 2,
      amount: 10,
      currency: 'GTQ',
    },
  ],
});

const world = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const fake = makeFakeMongoDb(seed);
  const bus = makeRecordingEventBus();
  const layer = MongoProductOrderStoreLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoDatabaseTag, fake.db as Db),
        Layer.succeed(
          MongoUnitOfWorkTag,
          makeMongoUnitOfWork({ client: fake as never, db: fake.db as Db }),
        ),
        Layer.succeed(EventBusTag, bus),
        Layer.succeed(OutboxMaxAttempts, 3),
        Layer.succeed(EventSourceTag, 'order'),
      ),
    ),
  );
  const run = <A, E>(use: (store: ProductOrderStore) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* ProductOrderStoreTag);
      }).pipe(Effect.provide(layer)),
    );
  return { fake, bus, run };
};

describeProductOrderStoreContract('the Mongo store', () =>
  world().run(store => Effect.succeed(store)),
);

const anOrder = (id: string) =>
  Object.assign(new ProductOrder('buyer-1'), {
    id,
    status: 'pending',
    items: [new OrderItem('o-1', 'v-1', 2, 10, 'GTQ')],
  });

const statusOf = (fake: ReturnType<typeof makeFakeMongoDb>, id: string) =>
  fake.read(ORDER_COLLECTION).find(doc => doc['id'] === id)?.['status'];

describe('placing an order', () => {
  it('writes it, announces order.placed and drains it at once', async () => {
    const { fake, bus, run } = world();

    const placed = await run(store => store.place(anOrder('ord-1'), 'c-1'));

    expect(placed._tag).toBe('placed');
    expect(statusOf(fake, 'ord-1')).toBe('pending');
    expect(bus.published.map(event => event.id)).toEqual(['ord-1:placed']);
  });

  it('answers a redelivered command with the order it first wrote', async () => {
    const { fake, run } = world();
    await run(store => store.place(anOrder('ord-2'), 'c-2'));

    const again = await run(store => store.place(anOrder('ord-other'), 'c-2'));

    expect(again).toMatchObject({ _tag: 'replayed', order: { id: 'ord-2' } });
    expect(fake.read(ORDER_COLLECTION)).toHaveLength(1);
  });

  it('refuses a duplicate that remembers no order', async () => {
    const { run } = world({
      [COMMAND_INBOX_COLLECTION]: [{ commandId: 'c-3', claimedAt: 'then' }],
    });

    const error = await run(store =>
      Effect.flip(store.place(anOrder('ord-3'), 'c-3')),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });

  it('reports a write the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('insertOne', new Error('disk full'));

    const error = await run(store =>
      Effect.flip(store.place(anOrder('ord-4'), undefined)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('reading and removing', () => {
  it('reads an order back, answers nothing for an absent one, and removes one as compensation', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [stored('ord-5', 'pending')],
    });

    const found = await run(store => store.get('ord-5'));
    const absent = await run(store => store.get('ord-404'));
    const removed = await run(store => store.remove('ord-5'));
    const again = await run(store => store.remove('ord-5'));

    expect(found?.items[0]?.quantity).toBe(2);
    expect(absent).toBeUndefined();
    expect([removed, again]).toEqual([true, false]);
    expect(fake.read(ORDER_COLLECTION)).toEqual([]);
  });

  it('reports a read the driver failed, and a record that will not read back, as store failures', async () => {
    const broken = world();
    broken.fake.failOn('findOne', new Error('network down'));
    const failedRead = await broken.run(store =>
      Effect.flip(store.get('ord-x')),
    );
    expect(failedRead).toBeInstanceOf(EntifixConnError);

    const corrupt = world({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-bad', claimedAt: 'then', replay: { record: 'nope' } },
      ],
    });
    const unreadable = await corrupt.run(store =>
      Effect.flip(store.place(anOrder('ord-z'), 'c-bad')),
    );
    expect(unreadable).toBeInstanceOf(EntifixConnError);
  });
});

describe('fulfilling', () => {
  it('stamps the lines and moves the status, only while the order is paid', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [
        stored('ord-6', 'paid'),
        stored('ord-7', 'cancelling'),
      ],
    });
    const items = [
      Object.assign(new OrderItem('o-1', 'v-1', 2, 10, 'GTQ'), {
        fulfilledAt: new Date(),
      }),
    ];

    const fulfilled = await run(store =>
      store.fulfil('ord-6', items, 'fulfilled'),
    );
    const claimed = await run(store =>
      store.fulfil('ord-7', items, 'fulfilled'),
    );

    expect(fulfilled?.status).toBe('fulfilled');
    expect(fulfilled?.items[0]?.quantity).toBe(2);
    expect(claimed).toBeUndefined();
    expect(statusOf(fake, 'ord-7')).toBe('cancelling');
  });

  it('reports a fulfilment the driver failed as a store failure', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [stored('ord-8', 'paid')],
    });
    fake.failOn('findOneAndUpdate', new Error('network down'));

    const error = await run(store =>
      Effect.flip(store.fulfil('ord-8', [], 'paid')),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('the cancellation transitions', () => {
  it('claims a paid order once, answers a redelivery as replayed, and refuses one not paid', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [
        stored('ord-9', 'paid'),
        stored('ord-10', 'pending'),
      ],
    });

    const claimed = await run(store => store.claimCancellation('ord-9', 'k-1'));
    const again = await run(store => store.claimCancellation('ord-9', 'k-1'));
    const refused = await run(store =>
      store.claimCancellation('ord-10', undefined),
    );

    expect(claimed).toMatchObject({
      _tag: 'claimed',
      order: { status: 'cancelling' },
    });
    expect(again).toEqual({ _tag: 'replayed' });
    expect(refused).toEqual({ _tag: 'notClaimable' });
    expect(statusOf(fake, 'ord-10')).toBe('pending');
  });

  it('releases a claim back to paid, and reports when there was none', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [stored('ord-11', 'cancelling')],
    });

    const released = await run(store => store.releaseCancellation('ord-11'));
    const none = await run(store => store.releaseCancellation('ord-11'));

    expect([released, none]).toEqual([true, false]);
    expect(statusOf(fake, 'ord-11')).toBe('paid');
  });

  it('settles a claimed order, announcing order.cancelled, and settles nothing twice', async () => {
    const { fake, bus, run } = world({
      [ORDER_COLLECTION]: [stored('ord-12', 'cancelling')],
    });

    const settled = await run(store =>
      store.settleCancellation('ord-12', 's-1'),
    );
    const again = await run(store => store.settleCancellation('ord-12', 's-1'));
    const notClaimed = await run(store =>
      store.settleCancellation('ord-12', undefined),
    );

    expect(settled?.status).toBe('cancelled');
    expect(again).toBeUndefined();
    expect(notClaimed).toBeUndefined();
    expect(bus.published.map(event => event.id)).toEqual(['ord-12:cancelled']);
    expect(fake.read(OUTBOX_COLLECTION)).toHaveLength(1);
  });

  it('reports a release the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('findOneAndUpdate', new Error('network down'));

    const errors = await Promise.all([
      run(store => Effect.flip(store.releaseCancellation('ord-13'))),
      run(store => Effect.flip(store.claimCancellation('ord-13', undefined))),
    ]);

    expect(errors.every(error => error instanceof EntifixConnError)).toBe(true);
  });
});

describe('folding a capture', () => {
  it('moves a pending order to paid once, however often the event arrives', async () => {
    const { fake, run } = world({
      [ORDER_COLLECTION]: [stored('ord-14', 'pending')],
    });
    const claim = { consumer: 'order.payment.captured', eventId: 'pay-1:t' };

    const first = await run(store =>
      store.markPaid(claim, 'ord-14', '2026-10-25T00:00:00.000Z'),
    );
    const again = await run(store =>
      store.markPaid(claim, 'ord-14', '2026-10-25T00:00:00.000Z'),
    );

    expect([first, again]).toEqual(['claimed', 'duplicate']);
    expect(statusOf(fake, 'ord-14')).toBe('paid');
  });

  it('reports a fold the driver failed as a store failure', async () => {
    const { fake, run } = world();
    fake.failOn('updateOne', new Error('network down'));

    const error = await run(store =>
      Effect.flip(
        store.markPaid({ consumer: 'c', eventId: 'e' }, 'ord-15', 'now'),
      ),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('MongoProductOrderStoreLayer', () => {
  it('fails to build when its indexes cannot be ensured', async () => {
    const { fake, run } = world();
    fake.failOn('createIndex', new Error('not primary'));

    await expect(run(() => Effect.void)).rejects.toThrow();
  });
});
