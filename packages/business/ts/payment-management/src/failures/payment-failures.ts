import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A refund asking for more than is left of the order's share. A conflict with
 * the ledger as it stands, not a malformed request: the same amount succeeded
 * before an earlier refund took part of it. `remaining` is what was left when
 * this one was refused — a hint, since a racing refund may already have moved it.
 */
export class RefundExceedsCapture extends Failure.conflict<RefundExceedsCapture>()(
  'RefundExceedsCapture',
  'refundExceedsCapture',
  {
    orderId: Schema.String,
    requested: Schema.Number,
    remaining: Schema.Number,
  },
  {
    message: ({ requested, remaining }) =>
      `${String(requested)} asked back, ${String(remaining)} left to refund`,
  },
) {}

/**
 * A cash-on-delivery order worth more than a courier is trusted to carry. A
 * business refusal the buyer can act on, by paying that seller by card.
 */
export class CodOverLimit extends Failure.declined<CodOverLimit>()(
  'CodOverLimit',
  'codOverLimit',
  { vendorId: Schema.String, amount: Schema.Number, limit: Schema.Number },
  {
    message: ({ amount, limit }) =>
      `${String(amount)} is over the cash-on-delivery limit of ${String(limit)}`,
  },
) {}

/**
 * A seller who does not ship cash on delivery — not provisioned for
 * `shipping-order-management`, or cash on delivery switched off fleet-wide.
 */
export class CodNotEntitled extends Failure.declined<CodNotEntitled>()(
  'CodNotEntitled',
  'codNotEntitled',
  { vendorId: Schema.String },
  {
    message: ({ vendorId }) =>
      `vendor ${vendorId} does not accept cash on delivery`,
  },
) {}
