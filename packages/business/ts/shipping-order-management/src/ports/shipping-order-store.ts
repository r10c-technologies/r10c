import type { Invalid, NotFound, StoreFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { ShippingOrder } from '../entities/shipping-order';
import type { ShippingOrderNotTransitionable } from '../failures/shipping-failures';
import type { Guide } from '../values/courier';
import type { ShippingTransition } from '../values/shipping-transition';
import type { ParcelInTransit } from './courier-tracking';

/** How opening went: a new shipment, or the one a repeated command opened. */
export type OpenOutcome =
  | { readonly _tag: 'opened'; readonly order: ShippingOrder }
  | { readonly _tag: 'replayed'; readonly order: ShippingOrder };

/** What one pass of the destination retention sweep did (ADR 0076 §4). */
export interface DestinationRedaction {
  readonly redacted: number;
  /** The shipments a redaction failed for, each with the failure it failed with. */
  readonly failed: ReadonlyArray<{
    readonly database: string;
    readonly shippingOrderId: string;
    readonly failure: unknown;
  }>;
}

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
  /**
   * Record the parcel's guide, conditional on the shipment still awaiting
   * dispatch; the last one recorded wins (ADR 0081 §11). `undefined` when the
   * shipment is not there or has moved on.
   */
  readonly recordGuide: (
    organizationId: string,
    shippingOrderId: string,
    guide: Guide,
    at: Date,
  ) => Effect.Effect<ShippingOrder | undefined, ShippingStoreFailure>;
  /**
   * Every parcel dispatched and not yet reported on, across every
   * organization's store, at most `limit` of them: what a courier's tracking
   * feed is asked about.
   */
  readonly inTransit: (
    limit: number,
  ) => Effect.Effect<readonly ParcelInTransit[], StoreFailure>;
  /**
   * The retention sweep's write, across every organization's store: remove
   * the `destination` of each shipment delivered, returned or withdrawn before
   * `before`, stamping `redactedAt` with `at`. The copy its opening command
   * remembered for a redelivery goes with it. Each shipment is its own write,
   * so one that fails is reported and the rest still go; a pass that cannot
   * list the stores fails.
   */
  readonly redactClosedBefore: (
    before: Date,
    at: Date,
  ) => Effect.Effect<DestinationRedaction, StoreFailure>;
}

export class ShippingOrderStoreTag extends Context.Service<
  ShippingOrderStoreTag,
  ShippingOrderStore
>()('ShippingOrderStoreTag') {}
