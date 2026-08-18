/**
 * How the money arrived.
 *
 * TMF670's vocabulary, narrowed. The standard's `PaymentMethod` is a resource
 * with a stored token, an owner and an expiry; what a `Payment` needs to record
 * is only which *kind* of tender was used, so this is a closed set rather than a
 * second entity. A tokenized card belongs to the PSP adapter, not here.
 *
 * `cash` is the member that makes this worth existing at all. Every payment
 * before in-site selling was a card through the storefront, so the field could
 * be inferred; a vendor taking notes at a counter cannot be
 * ([ADR 0024](../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * It is also the one method with no authorization step — see
 * {@link PaymentStatus}.
 */
export const PaymentMethods = ['cash', 'card', 'voucher', 'transfer'] as const;

export type PaymentMethod = (typeof PaymentMethods)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a method. */
export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' &&
  (PaymentMethods as readonly string[]).includes(value);
