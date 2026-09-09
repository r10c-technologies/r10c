import { ProductOrder } from '@r10c/business-ts-order-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** Where an order lives. The entity's own key, as every collection name is. */
export const PRODUCT_ORDER_COLLECTION = envelopeEntityName(ProductOrder);

/**
 * The two indexes the scoped reads run on.
 *
 * ⚠️ **The scope is a predicate rather than a database handle here**, because
 * this store is platform plane and single-partitioned — one database holding
 * every buyer's receipts. stock-service scopes by *which* `stock_<id>` a request
 * resolves to and needs no index for it; every read here is a filter over one
 * collection, so an unindexed predicate is a collection scan that grows with the
 * whole marketplace rather than with the caller's own orders.
 *
 * `placedAt` descending is the second key on both, not decoration: an order list
 * is read newest-first, and an index that covers the predicate but not the sort
 * leaves Mongo sorting the matched set in memory.
 *
 * `items.vendorId` is a path into a `composition`, which is the accepted cost of
 * one receipt per checkout ([ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)):
 * a basket can span vendors, so one order cannot live in any one vendor's
 * database, and "orders for vendor X" is a query into an array. Mongo indexes an
 * embedded array path element-wise, so this is an ordinary index rather than a
 * special case.
 *
 * Ensured at boot rather than per handle: unlike a tenant database this one is
 * named at boot, so there is a moment at which it exists. `createIndex` is
 * idempotent.
 */
export const ensureProductOrderIndexes = (db: Db) =>
  Effect.promise(async () => {
    const collection = db.collection(PRODUCT_ORDER_COLLECTION);
    // The buyer's own orders — "my orders", and the predicate a session with no
    // organization reads under.
    await collection.createIndex(
      { buyerId: 1, placedAt: -1 },
      { name: 'buyerId_1_placedAt_-1' },
    );
    // The orders that owe a vendor a line.
    await collection.createIndex(
      { 'items.vendorId': 1, placedAt: -1 },
      { name: 'items.vendorId_1_placedAt_-1' },
    );
  });
