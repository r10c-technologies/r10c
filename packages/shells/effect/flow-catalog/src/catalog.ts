import type { Recipe } from '@entifix/business/compose';
import { defineCatalog, flowCommit } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { ORDER_FRAGMENTS } from '@r10c/business-ts-order-management';
import { PAYMENT_FRAGMENTS } from '@r10c/business-ts-payment-management';
import { STOCK_FRAGMENTS } from '@r10c/business-ts-stock-management';
import { Schema } from 'effect';

/**
 * Every fragment r10c composes flows from, assembled in the one place allowed
 * to name every domain (ADR 0065). A domain declares its own fragments; this
 * shell only collects them, and a recipe references them by `id@n` string.
 */
export const flowCatalog = defineCatalog([
  ...STOCK_FRAGMENTS,
  ...ORDER_FRAGMENTS,
  ...PAYMENT_FRAGMENTS,
  flowCommit,
]);

/** The payment methods a checkout can be composed for. */
export const PAYMENT_METHODS = ['card', 'cashOnDelivery'] as const;

/** What a checkout starts from: how the buyer pays, and whose lines are in it. */
export const CheckoutStart = openStruct({
  paymentMethod: Schema.Literals(PAYMENT_METHODS),
  vendors: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
});
export type CheckoutStart = typeof CheckoutStart.Type;

const paysByCard = (_context: unknown, start: CheckoutStart) =>
  start.paymentMethod === 'card';

/**
 * Checkout, step for step as `checkout.saga.ts` runs it today: hold each
 * line, write the receipt, take the money, convert the holds. A
 * cash-on-delivery basket takes no money, so its commit point is
 * `flow.commit@1` and its conversions still run after one (ADR 0070).
 */
export const checkoutRecipe: Recipe<CheckoutStart> = {
  name: 'checkout',
  input: CheckoutStart,
  requiresCommitPoint: true,
  segments: start =>
    start.vendors.map(vendor => ({
      vendor,
      paymentMethod: start.paymentMethod,
    })),
  stages: [
    { name: 'hold', perSegment: true, steps: [{ ref: 'stock.reserve@1' }] },
    { name: 'order', steps: [{ ref: 'order.write@1' }] },
    {
      name: 'pay',
      steps: [
        { ref: 'payment.capture@1', when: paysByCard },
        {
          ref: 'flow.commit@1',
          when: (context, start) => !paysByCard(context, start),
        },
      ],
    },
    { name: 'convert', perSegment: true, steps: [{ ref: 'stock.convert@1' }] },
  ],
};

/** What a cancellation starts from: the order it cancels. */
export const CancellationStart = openStruct({
  orderId: Schema.NonEmptyString,
});
export type CancellationStart = typeof CancellationStart.Type;

/**
 * Cancellation, step for step as `cancellation.saga.ts` runs it today: claim
 * the order, refund — the pivot — put the goods back, close the record.
 */
export const cancellationRecipe: Recipe<CancellationStart> = {
  name: 'cancellation',
  input: CancellationStart,
  requiresCommitPoint: true,
  stages: [
    { name: 'claim', steps: [{ ref: 'order.claim-cancel@1' }] },
    { name: 'refund', steps: [{ ref: 'payment.refund@1' }] },
    { name: 'restore', steps: [{ ref: 'stock.restore@1' }] },
    { name: 'close', steps: [{ ref: 'order.close-cancelled@1' }] },
  ],
};

/** Every recipe, by name — what `$metadata` resolves a verb's recipe against. */
export const FLOW_RECIPES = {
  checkout: checkoutRecipe,
  cancellation: cancellationRecipe,
} as const;
