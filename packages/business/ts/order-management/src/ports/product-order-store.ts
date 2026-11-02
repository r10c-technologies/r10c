import type { StoreFailure, StoreFault } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { ProductOrder } from '../entities/product-order';
import type { OrderItem } from '../values/order-item';

/** How placing an order went. `replayed` answers what a redelivery first wrote. */
export type OrderPlacement =
  | { readonly _tag: 'placed'; readonly order: ProductOrder }
  | { readonly _tag: 'replayed'; readonly order: ProductOrder };

/** How claiming an order for cancellation went. */
export type CancellationClaim =
  | { readonly _tag: 'claimed'; readonly order: ProductOrder }
  | { readonly _tag: 'replayed' }
  | { readonly _tag: 'notClaimable' };

/**
 * The `order` store. Every transition is a conditional write on the status it
 * leaves, so two writers can never both move one order — and the two that
 * announce something (placing, settling a cancellation) commit their event
 * with the write.
 */
export interface ProductOrderStore {
  readonly get: (
    orderId: string,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** Write a new order and announce `order.placed`, claimed on the command. */
  readonly place: (
    order: ProductOrder,
    commandId: string | undefined,
  ) => Effect.Effect<OrderPlacement, StoreFailure>;
  /** The checkout's compensation. Answers whether there was one to remove. */
  readonly remove: (orderId: string) => Effect.Effect<boolean, StoreFault>;
  /** Stamp lines fulfilled, only while the order is `paid`. */
  readonly fulfil: (
    orderId: string,
    items: readonly OrderItem[],
    status: string,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** `paid → cancelling`, the concurrency claim a cancellation takes first. */
  readonly claimCancellation: (
    orderId: string,
    commandId: string | undefined,
  ) => Effect.Effect<CancellationClaim, StoreFault>;
  /** `cancelling → paid`, the claim's compensation. */
  readonly releaseCancellation: (
    orderId: string,
  ) => Effect.Effect<boolean, StoreFault>;
  /** `cancelling → cancelled`, announcing `order.cancelled`. */
  readonly settleCancellation: (
    orderId: string,
    commandId: string | undefined,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** `pending → paid`, folding one `payment.captured` exactly once. */
  readonly markPaid: (
    claim: { readonly consumer: string; readonly eventId: string },
    orderId: string,
    paidAt: string,
  ) => Effect.Effect<'claimed' | 'duplicate', StoreFault>;
}

export class ProductOrderStoreTag extends Context.Service<
  ProductOrderStoreTag,
  ProductOrderStore
>()('ProductOrderStoreTag') {}
