/**
 * The outcome of a payment attempt.
 *
 * `pending` → `authorized` → `captured`, with `failed` reachable from the first
 * two. Authorization and capture are kept apart because they are what a real
 * payment service provider distinguishes, and collapsing them into a single
 * `paid` would make the eventual PSP adapter model something the domain cannot
 * express — a hold taken at checkout and settled on dispatch.
 *
 * `captured` is the state order-management converts a stock reservation on;
 * `failed` releases it.
 */
export const PaymentStatuses = [
  'pending',
  'authorized',
  'captured',
  'failed',
] as const;

export type PaymentStatus = (typeof PaymentStatuses)[number];

/** Narrow an unknown value to a payment status. */
export const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' &&
  (PaymentStatuses as readonly string[]).includes(value);
