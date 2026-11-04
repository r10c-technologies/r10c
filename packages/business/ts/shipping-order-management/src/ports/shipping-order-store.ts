import type { Invalid, NotFound, StoreFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { ShippingOrder } from '../entities/shipping-order';
import type { ShippingOrderNotTransitionable } from '../failures/shipping-failures';
import type { ShippingTransition } from '../values/shipping-transition';

/** How opening went: a new shipment, or the one a repeated command opened. */
export type OpenOutcome =
  | { readonly _tag: 'opened'; readonly order: ShippingOrder }
  | { readonly _tag: 'replayed'; readonly order: ShippingOrder };

/**
 * What reaching an organization's store can fail with: the store, or an
 * organization id the tenant resolver refuses.
 */
export type ShippingStoreFailure = StoreFailure | Invalid;

/**
 * The `fulfilment` store, one organization's database at a time.
 *
 * ⚠️ **Every move is one conditional write** on the status the move is legal
 * from. That is the whole concurrency story: a dispatch and a hold racing on
 * one shipment both read `awaiting-dispatch`, and the write that lands second
 * finds the status moved and is refused — exactly one wins.
 */
export interface ShippingOrderStore {
  readonly get: (
    organizationId: string,
    shippingOrderId: string,
  ) => Effect.Effect<ShippingOrder | undefined, ShippingStoreFailure>;
  /** Open a shipment in `awaiting-dispatch`, claimed on the command. */
  readonly open: (
    organizationId: string,
    order: ShippingOrder,
    commandId: string | undefined,
  ) => Effect.Effect<OpenOutcome, ShippingStoreFailure>;
  /**
   * Make one move, conditional on the status it is legal from, stamping the
   * moment where the move carries one. A repeated command answers the record
   * as the first delivery left it.
   */
  readonly transition: (
    organizationId: string,
    shippingOrderId: string,
    transition: ShippingTransition,
    at: Date,
    commandId: string | undefined,
  ) => Effect.Effect<
    ShippingOrder,
    NotFound | ShippingOrderNotTransitionable | ShippingStoreFailure
  >;
}

export class ShippingOrderStoreTag extends Context.Service<
  ShippingOrderStoreTag,
  ShippingOrderStore
>()('ShippingOrderStoreTag') {}
