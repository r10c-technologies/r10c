import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { PAYMENT_COLLECTION, REFUND_COLLECTION } from './outbox';

/**
 * The indexes this store needs, ensured at boot.
 *
 * At boot rather than per handle: the `payment` store is platform-plane and
 * single, so there is one database and one moment to do it in — which a tenant
 * store cannot say. `createIndex` is idempotent, so this is safe on every start.
 *
 * ⚠️ **The unique one is a correctness guard, not a speed-up.** `POST /api/refund`
 * reads for an existing refund before it calls the provider, and that read plus
 * the write is not atomic — two commands aimed at one capture can both find
 * nothing. The index is what makes the second insert fail instead of paying a
 * vendor's customer twice, and the route reads the duplicate-key error as
 * "somebody else already did this"
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * ⚠️ **It also encodes "the whole capture, never a part of it".** Partial
 * refunds are out of v1 scope, and this is where that is true in storage rather
 * than in review — adding them means dropping this index deliberately.
 */
export const ensurePaymentIndexes = (db: Db) =>
  Effect.promise(async () => {
    // A refund is addressed by order and resolves its own capture, so this is
    // the read on the hot path of every cancellation.
    await db
      .collection(PAYMENT_COLLECTION)
      .createIndex({ orderId: 1, status: 1 }, { name: 'orderId_1_status_1' });

    await db
      .collection(REFUND_COLLECTION)
      .createIndex({ paymentId: 1 }, { unique: true, name: 'paymentId_1' });
  });

/**
 * The same work as a `Layer`, so a composition root can merge it rather than
 * reach for a Mongo tag itself.
 *
 * That matters for the `mock` e2e profile: its composition root has no business
 * importing `entifix-ts-mongo-client` just to name a tag, and the unique index
 * below is load-bearing for one of its assertions.
 */
export const PaymentIndexesLayer = Layer.effectDiscard(
  Effect.flatMap(MongoDatabaseTag, database => ensurePaymentIndexes(database)),
);
