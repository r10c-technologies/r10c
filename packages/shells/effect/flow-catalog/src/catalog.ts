import type { Recipe } from '@entifix/business/compose';
import { defineCatalog, flowCommit } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { ORDER_FRAGMENTS } from '@r10c/business-ts-order-management';
import { PAYMENT_FRAGMENTS } from '@r10c/business-ts-payment-management';
import { OrderTenders } from '@r10c/business-ts-sales-vocabulary';
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

/**
 * The tenders a checkout can be composed for — the one set the order, payment
 * and shipping records carry, `cod` included (ADR 0070).
 */
export const PAYMENT_METHODS = OrderTenders;

/** What a checkout starts from: how the buyer pays, and whose lines are in it. */
export const CheckoutStart = openStruct({
  paymentMethod: Schema.Literals(PAYMENT_METHODS),
  vendors: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
});
export type CheckoutStart = typeof CheckoutStart.Type;

/** Money taken at checkout — card online, cash at a counter — rather than on delivery. */
const paysNow = (_context: unknown, start: CheckoutStart) =>
  start.paymentMethod !== 'cod';

/**
 * Checkout: open the buyer's group, hold each vendor's lines and write that
 * vendor's order, take the money for the whole group, then confirm each order
 * and convert its holds. A cash-on-delivery basket takes no money, so its
 * commit point is `flow.commit@1` and its confirmations and conversions still
 * run after one (ADR 0069, ADR 0070).
 *
 * ⚠️ **No longer the saga runner's flow, step for step.** The capture and
 * refund moved to per-order allocations (#480) and the runner's definitions
 * did not; #486 moves checkout onto the engine from this recipe.
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
    { name: 'group', steps: [{ ref: 'order.open-group@1' }] },
    { name: 'hold', perSegment: true, steps: [{ ref: 'stock.reserve@1' }] },
    { name: 'order', perSegment: true, steps: [{ ref: 'order.write@2' }] },
    {
      name: 'pay',
      steps: [
        { ref: 'payment.capture@2', when: paysNow },
        {
          ref: 'flow.commit@1',
          when: (context, start) => !paysNow(context, start),
        },
      ],
    },
    { name: 'confirm', perSegment: true, steps: [{ ref: 'order.confirm@1' }] },
    { name: 'convert', perSegment: true, steps: [{ ref: 'stock.convert@1' }] },
  ],
};

/** What a cancellation starts from: the order it cancels. */
export const CancellationStart = openStruct({
  orderId: Schema.NonEmptyString,
});
export type CancellationStart = typeof CancellationStart.Type;

/**
 * Cancellation: claim the order, refund — the pivot — put the goods back,
 * close the record. #487 moves it onto the engine from this recipe.
 */
export const cancellationRecipe: Recipe<CancellationStart> = {
  name: 'cancellation',
  input: CancellationStart,
  requiresCommitPoint: true,
  stages: [
    { name: 'claim', steps: [{ ref: 'order.claim-cancel@2' }] },
    { name: 'refund', steps: [{ ref: 'payment.refund@2' }] },
    { name: 'restore', steps: [{ ref: 'stock.restore@1' }] },
    { name: 'close', steps: [{ ref: 'order.close@1' }] },
  ],
};

/** Every recipe, by name — what `$metadata` resolves a verb's recipe against. */
export const FLOW_RECIPES = {
  checkout: checkoutRecipe,
  cancellation: cancellationRecipe,
} as const;
