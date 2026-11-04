import type { NotFound, StoreFailure, StoreFault } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { CheckoutGroup } from '../entities/checkout-group';
import type { ProductOrder } from '../entities/product-order';
import type { OrderTransition } from '../values/order-transition';

/** How placing an order went: a new order, or the one a repeated command placed. */
export type OrderPlacement =
  | { readonly _tag: 'placed'; readonly order: ProductOrder }
  | { readonly _tag: 'replayed'; readonly order: ProductOrder };

/** How a cancellation claim went. */
export type CancellationClaim =
  | { readonly _tag: 'claimed'; readonly order: ProductOrder }
  | { readonly _tag: 'replayed' }
  | { readonly _tag: 'notClaimable' };

/** How opening a checkout group went. */
export type GroupOpening =
  | { readonly _tag: 'opened'; readonly group: CheckoutGroup }
  | { readonly _tag: 'replayed'; readonly group: CheckoutGroup };

/**
 * The `order` store's vendor orders. Every move is a conditional write on the
 * statuses it is legal from; placing, and every move that ends an order
 * cancelled, announce themselves in the same unit.
 */
export interface ProductOrderStore {
  readonly get: (
    orderId: string,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** Every vendor order in one checkout group. */
  readonly forGroup: (
    groupId: string,
  ) => Effect.Effect<readonly ProductOrder[], StoreFault>;
  /**
   * Place a vendor order, adding it to its group in the same unit; refused
   * `NotFound` when the group it names was never opened.
   */
  readonly place: (
    order: ProductOrder,
    commandId: string | undefined,
  ) => Effect.Effect<OrderPlacement, StoreFailure | NotFound>;
  /** A compensation: delete the order and take it out of its group. */
  readonly remove: (orderId: string) => Effect.Effect<boolean, StoreFault>;
  /**
   * Make one move, conditional on the statuses it is legal from; `undefined`
   * when the order stood anywhere else. A repeated command answers the order as
   * it stands.
   */
  readonly move: (
    orderId: string,
    transition: Exclude<OrderTransition, 'claim-cancel' | 'settle-cancel'>,
    commandId: string | undefined,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** Claim a `paid` or `confirmed` order for cancellation, remembering which. */
  readonly claimCancellation: (
    orderId: string,
    commandId: string | undefined,
  ) => Effect.Effect<CancellationClaim, StoreFault>;
  /** The claim's compensation: back to the status it was claimed from. */
  readonly releaseCancellation: (
    orderId: string,
  ) => Effect.Effect<boolean, StoreFault>;
  /** Close a claimed order as cancelled, and announce it. */
  readonly settleCancellation: (
    orderId: string,
    commandId: string | undefined,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** Fold one order's share of a capture: `pending → paid`, once per claim. */
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

/**
 * The `order` store's checkout groups — the buyer's receipt across sellers.
 * Opened before its orders, and deleted only as the checkout's compensation.
 */
export interface CheckoutGroupStore {
  readonly get: (
    groupId: string,
  ) => Effect.Effect<CheckoutGroup | undefined, StoreFault>;
  readonly open: (
    group: CheckoutGroup,
    commandId: string | undefined,
  ) => Effect.Effect<GroupOpening, StoreFailure>;
  readonly remove: (groupId: string) => Effect.Effect<boolean, StoreFault>;
}

export class CheckoutGroupStoreTag extends Context.Service<
  CheckoutGroupStoreTag,
  CheckoutGroupStore
>()('CheckoutGroupStoreTag') {}
