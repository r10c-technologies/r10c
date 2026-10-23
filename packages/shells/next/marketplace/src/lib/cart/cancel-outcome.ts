/**
 * What the confirmation page is told a cancel attempt did, as a search param.
 *
 * Three outcomes, because the buyer has three different things to do next:
 * nothing (`cancelled`), wait and click again (`pending`), or stop trying
 * (`failed`).
 */
export const CancelOutcomes = ['cancelled', 'pending', 'failed'] as const;

export type CancelOutcome = (typeof CancelOutcomes)[number];

/**
 * Narrow a query param to an outcome.
 *
 * The value decides a translation key, so an arbitrary query param must not be
 * able to name one.
 */
export const isCancelOutcome = (value: unknown): value is CancelOutcome =>
  (CancelOutcomes as readonly unknown[]).includes(value);

/**
 * Read order-service's answer to a buyer's cancel.
 *
 * ⚠️ **`paymentPending` is the one refusal that is worth retrying.** Checkout
 * captures the money synchronously, but the order turns `paid` only once
 * `payment.captured` is consumed off the bus, so a buyer who cancels straight
 * from the confirmation page can arrive before it. Every other refusal (a
 * closed window, an order already on its way, a network failure) reads
 * `failed`, because clicking again would not change the answer.
 */
export const cancelOutcomeOf = (
  status: number | undefined,
  code: unknown,
): CancelOutcome => {
  if (status !== undefined && status >= 200 && status < 300) return 'cancelled';
  if (status === 409 && code === 'paymentPending') return 'pending';
  return 'failed';
};
