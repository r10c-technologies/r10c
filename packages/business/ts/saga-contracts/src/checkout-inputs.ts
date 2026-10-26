import type { SagaInputs } from './saga-starter.js';

/** What a checkout needs to know about one line of a basket. */
export interface CheckoutLineInput {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
  /** The unit price, from the published projection — never from a request. */
  readonly amount: number;
  readonly currency: string;
}

/** A basket's total. The currency is the lines' own; `fallback` names an empty one's. */
export const basketTotal = (
  lines: readonly CheckoutLineInput[],
  fallback: string,
) =>
  lines.reduce(
    (total, line) => ({
      amount: total.amount + line.amount * line.quantity,
      currency: line.currency,
    }),
    { amount: 0, currency: fallback },
  );

/**
 * The checkout saga's inputs, for any host that sells: the storefront and the
 * till build the same reserve, write and capture.
 *
 * - `reserve` holds each line in its vendor's own stock store, so the line's
 *   `vendorId` is the organization the crossing names.
 * - `write-order` carries the lines as the order's items plus whatever the host
 *   adds to the order (`order`): a channel at a counter, a cancel digest online.
 * - `capture-payment` takes the basket's total. ⚠️ **Its `orderId` is a
 *   template, not a value**: order-service mints the id, so it does not exist
 *   yet, and the engine resolves it from the `write-order` step's recorded
 *   outcome before dispatching the capture. A literal here is a payment
 *   attached to nothing.
 * - `convert-reservation` takes no input: its cardinality and its addresses
 *   come from the holds `reserve` actually took.
 */
export const checkoutInputs = <L extends CheckoutLineInput>(checkout: {
  readonly lines: readonly L[];
  readonly order?: Readonly<Record<string, unknown>>;
  readonly payment: {
    readonly paymentMethod: string;
    readonly fallbackCurrency: string;
    readonly channelId?: string;
  };
}): SagaInputs => {
  const total = basketTotal(checkout.lines, checkout.payment.fallbackCurrency);
  return {
    reserve: checkout.lines.map(line => ({
      organizationId: line.vendorId,
      body: {
        meta: { type: 'entity', entity: 'reservation' },
        data: { offeringId: line.offeringId, quantity: line.quantity },
      },
    })),
    'write-order': [
      {
        body: {
          meta: { type: 'entity', entity: 'product-order' },
          data: { items: checkout.lines, ...checkout.order },
        },
      },
    ],
    'capture-payment': [
      {
        body: {
          meta: { type: 'entity', entity: 'payment' },
          data: {
            orderId: '{steps.write-order.data.id}',
            amount: total.amount,
            currency: total.currency,
            paymentMethod: checkout.payment.paymentMethod,
            ...(checkout.payment.channelId === undefined
              ? {}
              : { channelId: checkout.payment.channelId }),
          },
        },
      },
    ],
  };
};
