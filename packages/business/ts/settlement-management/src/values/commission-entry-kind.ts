/**
 * Whether a ledger line records a sale or reverses one.
 *
 * The *storno* shape: a cancellation does not delete the sale's line or edit its
 * amounts, it writes a mirror of it with both signs flipped and leaves both rows
 * on file. A deletion would leave a total nothing explains, and an edit would
 * erase the evidence of what the platform actually took — the same reason a
 * refund is its own record rather than a status written over the capture
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md) §9).
 *
 * It is also the third key of the ledger's unique index. One row per
 * `(orderId, vendorId)` **per kind** is what lets the reversal exist at all
 * while still refusing a second sale or a second reversal for the same pair.
 */
export const CommissionEntryKinds = ['sale', 'reversal'] as const;

export type CommissionEntryKind = (typeof CommissionEntryKinds)[number];

/** Narrow an unknown value to a commission entry kind. */
export const isCommissionEntryKind = (
  value: unknown,
): value is CommissionEntryKind =>
  typeof value === 'string' &&
  (CommissionEntryKinds as readonly string[]).includes(value);
