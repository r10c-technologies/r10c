/**
 * What a movement answers to, so a ledger line can be joined to the record
 * that caused it (ADR 0078 §6):
 *
 * - `manual` — a vendor's own movement (a delivery, a count, a write-off); the
 *   cause is the movement itself.
 * - `reservation` — a hold converted to a sale; the cause is the hold.
 * - `product-order` — goods put back for a cancelled or returned order; the
 *   cause is the order.
 */
export const MovementCauseTypes = [
  'manual',
  'reservation',
  'product-order',
] as const;

export type MovementCauseType = (typeof MovementCauseTypes)[number];
