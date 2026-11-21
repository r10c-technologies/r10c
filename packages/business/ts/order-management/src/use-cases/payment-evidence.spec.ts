import { IdempotencyKeyTag } from '@entifix/business';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import { ObjectStoreTag } from '@r10c/business-ts-object-storage';
import { makeInMemoryObjectStore } from '@r10c/business-ts-object-storage/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../entities/checkout-group/index.js';
import { ProductOrder } from '../entities/product-order/index.js';
import {
  CheckoutGroupStoreTag,
  ProductOrderStoreTag,
} from '../ports/product-order-store.js';
import { documentOrder } from '../testing/fiscal-facts.js';
import { makeInMemoryOrderStores } from '../testing/in-memory-product-order-store.js';
import { digestOf } from '../values/cancel-capability.js';
import { OrderItem } from '../values/order-item.js';
import {
  attachEvidenceAsBuyer,
  attachEvidenceAsVendor,
  awaitPayment,
  evidenceForBuyer,
  evidenceForStaff,
  EvidenceLimits,
  openGroup,
  placeOrder,
  redactEndedReceipts,
  sweepOrphanEvidence,
} from './order-flows.js';

const GROUP = '7b6f2b0e-6a0c-4b8e-9d55-0f0e6a3a1c11';
const NONCE = 'the-nonce';
const VENDOR = { kind: 'vendor', organizationId: 'v-1' } as const;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PDF = new TextEncoder().encode('%PDF-1.7 receipt');

/** A real order waiting for its payment link, its group holding the nonce. */
const world = async (limits = { maxBytes: 64, maxCount: 2 }) => {
  let clock = new Date('2026-11-20T10:00:00Z');
  const stores = makeInMemoryOrderStores();
  const objects = makeInMemoryObjectStore(() => clock);
  const layer = Layer.mergeAll(
    Layer.succeed(ProductOrderStoreTag, stores.orders),
    Layer.succeed(CheckoutGroupStoreTag, stores.groups),
    Layer.succeed(ObjectStoreTag, objects),
    Layer.succeed(EvidenceLimits, limits),
    Layer.succeed(IdempotencyKeyTag, undefined as never),
    Layer.succeed(
      FlowStarterTag,
      makeScriptedFlowStarter(() => acceptedAnswer('flow-1')),
    ),
  );
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E>,
    );
  const refusal = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    run(Effect.flip(effect)) as Promise<{ code: string }>;

  await run(
    openGroup({
      group: Object.assign(new CheckoutGroup(), {
        id: GROUP,
        buyerId: 'buyer-1',
        cancelDigest: digestOf(NONCE),
      }),
      commandId: undefined,
      cancelWindowSeconds: 600,
      receiptDays: 30,
    }),
  );
  const { order } = await run(
    placeOrder({
      order: documentOrder(
        Object.assign(new ProductOrder('buyer-1'), {
          vendorId: 'v-1',
          groupId: GROUP,
          paymentMethod: 'link',
          items: [new OrderItem('o-1', 'Lámpara', 1, 10, 'GTQ')],
        }),
      ),
      rawLines: [],
      commandId: undefined,
    }),
  );
  const orderId = String(order.id);
  await run(
    awaitPayment({ orderId, paymentWindowMs: 60_000, commandId: undefined }),
  );
  return {
    run,
    refusal,
    stores,
    objects,
    orderId,
    tick: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
      return clock;
    },
  };
};

describe('attaching a payment receipt', () => {
  it('lets the buyer attach by the receipt capability, and keeps the bytes by key', async () => {
    const { run, objects, orderId } = await world();

    const order = await run(
      attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PNG }),
    );

    const [entry] = order.paymentEvidence;
    expect(entry).toMatchObject({
      contentType: 'image/png',
      byteSize: PNG.length,
      attachedBy: 'buyer',
    });
    expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(objects.keys()).toEqual([entry?.objectKey]);
    expect(entry?.objectKey).toBe(`evidence/${orderId}/${entry?.id}`);
  });

  it('answers the first attachment when the same file is sent again', async () => {
    const { run, objects, orderId } = await world();
    await run(attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PNG }));

    const again = await run(
      attachEvidenceAsVendor({ orderId, scope: VENDOR, bytes: PNG }),
    );

    expect(again.paymentEvidence).toHaveLength(1);
    expect(objects.keys()).toHaveLength(1);
  });

  it('refuses bytes that are no receipt, whatever they claim, and too many bytes', async () => {
    const { refusal, objects, orderId } = await world();
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');

    expect(
      await refusal(
        attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: svg }),
      ),
    ).toMatchObject({ code: 'evidenceTypeRefused' });
    expect(
      await refusal(
        attachEvidenceAsBuyer({
          orderId,
          nonce: NONCE,
          bytes: new Uint8Array([...PDF, ...new Uint8Array(64)]),
        }),
      ),
    ).toMatchObject({ code: 'evidenceTooLarge', maxBytes: 64 });
    expect(objects.keys()).toEqual([]);
  });

  it('refuses a receipt past the count, and writes nothing for it', async () => {
    const { run, refusal, objects, orderId } = await world();
    await run(attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PNG }));
    await run(attachEvidenceAsVendor({ orderId, scope: VENDOR, bytes: PDF }));

    expect(
      await refusal(
        attachEvidenceAsBuyer({
          orderId,
          nonce: NONCE,
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0]),
        }),
      ),
    ).toMatchObject({ code: 'evidenceLimitReached', maxCount: 2 });
    expect(objects.keys()).toHaveLength(2);
  });

  it('refuses a wrong capability alike, and another vendor as an absent order', async () => {
    const { refusal, orderId } = await world();

    expect(
      await refusal(
        attachEvidenceAsBuyer({ orderId, nonce: 'forged', bytes: PNG }),
      ),
    ).toMatchObject({ code: 'cancelNotAuthorized' });
    expect(
      await refusal(
        attachEvidenceAsBuyer({ orderId: 'nope', nonce: NONCE, bytes: PNG }),
      ),
    ).toMatchObject({ code: 'cancelNotAuthorized' });
    expect(
      await refusal(
        attachEvidenceAsVendor({
          orderId,
          scope: { kind: 'vendor', organizationId: 'v-2' },
          bytes: PNG,
        }),
      ),
    ).toMatchObject({ code: 'notFound' });
  });

  it('refuses an order no longer waiting, before writing any byte', async () => {
    const { run, refusal, stores, objects, orderId } = await world();
    await run(stores.orders.endAwaitingPayment(orderId, 'buyer', new Date()));

    expect(
      await refusal(
        attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PNG }),
      ),
    ).toMatchObject({ code: 'orderNotAwaitingPayment' });
    expect(objects.keys()).toEqual([]);
  });

  it('deletes the bytes it wrote when the append loses the race', async () => {
    for (const lost of ['cancelled', 'full'] as const) {
      const { run, refusal, stores, objects, orderId } = await world();
      const order = (await run(stores.orders.get(orderId))) as ProductOrder;
      // The order as the attach read it; then the race is lost at the store.
      if (lost === 'cancelled')
        await run(
          stores.orders.endAwaitingPayment(orderId, 'buyer', new Date()),
        );
      else {
        await run(
          attachEvidenceAsVendor({ orderId, scope: VENDOR, bytes: PNG }),
        );
        await run(
          attachEvidenceAsVendor({ orderId, scope: VENDOR, bytes: PDF }),
        );
      }
      const before = objects.keys().length;
      let reads = 0;
      const racing = Effect.provideService(
        attachEvidenceAsVendor({
          orderId,
          scope: VENDOR,
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
        }),
        ProductOrderStoreTag,
        {
          ...stores.orders,
          // The attach's own read sees the order still open; any read after
          // it sees the store as the race left it.
          get: (id: string) =>
            reads++ === 0 ? Effect.succeed(order) : stores.orders.get(id),
        },
      );

      expect(await refusal(racing)).toMatchObject({
        code:
          lost === 'cancelled'
            ? 'orderNotAwaitingPayment'
            : 'evidenceLimitReached',
      });
      expect(objects.keys()).toHaveLength(before);
    }
  });
});

describe('reading a payment receipt', () => {
  it('serves the bytes to the buyer and to the seller, under the sniffed type', async () => {
    const { run, orderId } = await world();
    const order = await run(
      attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PDF }),
    );
    const evidenceId = String(order.paymentEvidence[0]?.id);

    const forBuyer = await run(
      evidenceForBuyer({ orderId, evidenceId, nonce: NONCE }),
    );
    const forStaff = await run(
      evidenceForStaff({ orderId, evidenceId, scope: VENDOR }),
    );

    expect(forBuyer).toEqual({ bytes: PDF, contentType: 'application/pdf' });
    expect(forStaff).toEqual(forBuyer);
  });

  it('answers not found for an unknown receipt, or one whose file is gone', async () => {
    const { run, refusal, objects, orderId } = await world();
    const order = await run(
      attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PDF }),
    );
    const entry = order.paymentEvidence[0];

    expect(
      await refusal(
        evidenceForStaff({ orderId, evidenceId: 'nope', scope: VENDOR }),
      ),
    ).toMatchObject({ code: 'notFound' });
    await run(objects.delete(String(entry?.objectKey)));
    expect(
      await refusal(
        evidenceForBuyer({
          orderId,
          evidenceId: String(entry?.id),
          nonce: NONCE,
        }),
      ),
    ).toMatchObject({ code: 'notFound' });
  });
});

describe('the receipt files leave with the buyer’s data', () => {
  it('deletes the files of a redacted group and keeps the facts of each', async () => {
    const { run, stores, objects, orderId } = await world();
    await run(attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PDF }));
    // The group store decides which groups ended; its own contract covers how.
    const redacted = await run(
      Effect.provideService(
        redactEndedReceipts(new Date()),
        CheckoutGroupStoreTag,
        {
          ...stores.groups,
          redactEndedReceipts: () => Effect.succeed([GROUP]),
        },
      ),
    );

    expect(redacted).toBe(1);
    expect(objects.keys()).toEqual([]);
    const [entry] =
      (await run(stores.orders.get(orderId)))?.paymentEvidence ?? [];
    expect(entry?.objectKey).toBeUndefined();
    expect(entry?.redactedAt).toBeInstanceOf(Date);
  });

  it('sweeps a file no order points at once its grace has passed, and nothing else', async () => {
    const { run, objects, orderId, tick } = await world();
    await run(attachEvidenceAsBuyer({ orderId, nonce: NONCE, bytes: PDF }));
    await run(objects.put(`evidence/${orderId}/stray`, PNG, 'image/png'));

    expect(await run(sweepOrphanEvidence(tick(0), 86_400_000))).toBe(0);
    const later = tick(2 * 86_400_000);
    expect(await run(sweepOrphanEvidence(later, 86_400_000))).toBe(1);
    expect(objects.keys()).toHaveLength(1);
    expect(objects.keys()[0]).not.toContain('stray');
  });
});
