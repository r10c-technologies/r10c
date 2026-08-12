/**
 * Why a quantity moved.
 *
 * The set is closed because the ledger is the audit trail: a free-form reason
 * makes "why is this vendor's stock wrong?" unanswerable by query. It is also
 * the extension point named in
 * [ADR 0010](../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md) —
 * a future logistics integration adds a member here rather than a second ledger.
 */
export const MovementReasons = [
  'receipt',
  'sale',
  'cancellation',
  'adjustment',
] as const;

export type MovementReason = (typeof MovementReasons)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a reason. */
export const isMovementReason = (value: unknown): value is MovementReason =>
  typeof value === 'string' &&
  (MovementReasons as readonly string[]).includes(value);
