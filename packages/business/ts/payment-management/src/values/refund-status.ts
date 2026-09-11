/**
 * How a refund attempt went.
 *
 * `pending` → `refunded`, with `failed` reachable from the first. There is no
 * `authorized` beside them and there must not be: authorization and capture are
 * separate because a real provider holds money before taking it, and nothing
 * holds money on the way back out.
 *
 * A refund is **its own record**, never a status on the capture it reverses.
 * ADR 0054 protects the capture row as the evidence a customer was charged, so
 * a `'refunded'` member on {@link PaymentStatuses} would overwrite exactly the
 * fact a reconciliation needs
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * Deliberately **not** the same union as `PaymentStatus`. They answer different
 * questions and drift apart the moment either grows a member — a partial refund
 * would land here and nowhere else.
 */
export const RefundStatuses = ['pending', 'refunded', 'failed'] as const;

export type RefundStatus = (typeof RefundStatuses)[number];

/** Narrow an unknown value to a refund status. */
export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === 'string' &&
  (RefundStatuses as readonly string[]).includes(value);
