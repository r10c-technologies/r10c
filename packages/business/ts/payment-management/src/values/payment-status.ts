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
 *
 * A deliberate **narrowing of TMF676**, which carries seven states
 * (`pendingAuthorization`, `authorized`, `captured`, `failed`, `canceled`,
 * `denied`, `done`). Three of those are distinctions only a real PSP makes —
 * `denied` versus `failed` is the issuer's answer versus the network's, and
 * `done` is a settlement-side terminal — so adopting them now would be modelling
 * a system nobody has integrated. They are addable as members here, which is the
 * point of keeping the set closed.
 *
 * Cash skips the middle: a counter payment goes straight to `captured`, because
 * there is nothing to authorize when the money is already in the drawer
 * ([ADR 0024](../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
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
