import type { NotFound, StoreFailure, StoreFault } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { CheckoutGroup } from '../entities/checkout-group';
import type { ProductOrder } from '../entities/product-order';
import type { OrderTransition } from '../values/order-transition';
import type { PaymentLink } from '../values/payment-link';

/** What the seller confirmed a payment link with, and who and when. */
export interface PaymentConfirmation {
  readonly reference: string;
  readonly confirmedBy: string;
  readonly confirmedAt: Date;
}

/** Why an order waiting on its payment stopped waiting without one. */
export type AwaitingPaymentEnd = 'payment-expired' | 'buyer';

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
    transition: Exclude<
      OrderTransition,
      | 'claim-cancel'
      | 'settle-cancel'
      | 'await-payment'
      | 'confirm-payment'
      | 'end-awaiting-payment'
    >,
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
  /**
   * A payment-link order's commit point: `pending → awaiting-payment`,
   * stamping when it stops waiting. A repeated command answers the order as
   * it stands; `undefined` when it stood anywhere else.
   */
  readonly awaitPayment: (
    orderId: string,
    paymentDueAt: Date,
    commandId: string | undefined,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /**
   * The seller's confirmation: `awaiting-payment → paid`, recording the
   * authorization number, and announcing `order.payment-confirmed` in the
   * same unit. `undefined` when the order was not waiting — an expiry or a
   * withdrawal won (ADR 0081 §4).
   */
  readonly confirmPayment: (
    orderId: string,
    confirmation: PaymentConfirmation,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /**
   * An order that stops waiting without its payment: `awaiting-payment →
   * cancelled`, recording why, and announcing `order.cancelled` in the same
   * unit. An expiry matches only an order whose `paymentDueAt` is before
   * `now`. `undefined` when it was not waiting (or not yet due).
   */
  readonly endAwaitingPayment: (
    orderId: string,
    cause: AwaitingPaymentEnd,
    now: Date,
  ) => Effect.Effect<ProductOrder | undefined, StoreFault>;
  /** The ids of every order still waiting whose window ended before `now`. */
  readonly overduePayments: (
    now: Date,
  ) => Effect.Effect<readonly string[], StoreFault>;
  /**
   * Set the link the buyer pays by, on an order still waiting; the last one
   * set wins. `undefined` when the order was not waiting.
   */
  readonly setPaymentLink: (
    orderId: string,
    link: PaymentLink & { readonly setBy: string; readonly setAt: Date },
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
/** One mailed access link, as stored: its digest and its two stamps. */
export interface AccessGrant {
  readonly digest: string;
  readonly expiresAt: Date;
  readonly sentAt: Date;
}

export interface CheckoutGroupStore {
  readonly get: (
    groupId: string,
  ) => Effect.Effect<CheckoutGroup | undefined, StoreFault>;
  readonly open: (
    group: CheckoutGroup,
    commandId: string | undefined,
  ) => Effect.Effect<GroupOpening, StoreFailure>;
  readonly remove: (groupId: string) => Effect.Effect<boolean, StoreFault>;
  /**
   * Store a fresh access link on a group, replacing any earlier one; with
   * `notSentSince`, only when no link went out after it — one conditional
   * write, so two racing lookups mail once. `undefined` when the group does
   * not exist or the interval had not passed.
   */
  readonly issueAccess: (
    groupId: string,
    grant: AccessGrant,
    notSentSince?: Date,
  ) => Effect.Effect<CheckoutGroup | undefined, StoreFault>;
  /**
   * Redeem an access link: one conditional write that matches the digest and
   * an unexpired link, replaces the cancel digest with `cancelDigest` and
   * clears the link. The group's id, or `undefined` when nothing matched —
   * so of two racing redemptions exactly one wins.
   */
  readonly redeemAccess: (
    accessDigest: string,
    cancelDigest: string,
    now: Date,
  ) => Effect.Effect<string | undefined, StoreFault>;
  /** The group a number names: its own, or one of its vendor orders'. */
  readonly findByNumber: (
    number: string,
  ) => Effect.Effect<CheckoutGroup | undefined, StoreFault>;
  /**
   * The retention sweep's write (ADR 0076 §4): remove the buyer's `contact`
   * from every group whose receipt window ended before `now` and whose every
   * order is `fulfilled` or `cancelled`, stamping `redactedAt`. The copy the
   * group's opening command remembered for a redelivery goes with it, or the
   * data would leave the record and stay in the store. Answers how many
   * groups it redacted; a group already redacted is not counted again.
   */
  readonly redactEndedReceipts: (
    now: Date,
  ) => Effect.Effect<number, StoreFault>;
}

export class CheckoutGroupStoreTag extends Context.Service<
  CheckoutGroupStoreTag,
  CheckoutGroupStore
>()('CheckoutGroupStoreTag') {}
