import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The provider refused to send an order's money back.
 *
 * Here rather than in `payment-management` because two domains answer it: the
 * refund route that asked the provider, and the order whose cancellation that
 * refund was the pivot of. A code belongs to exactly one failure, and a
 * `business:domain` package may not import another, so the one failure lives
 * in the contract both read. Addressed by order, as the refund itself is.
 */
export class RefundDeclined extends Failure.declined<RefundDeclined>()(
  'RefundDeclined',
  'refundDeclined',
  { orderId: Schema.String, reason: Schema.optionalKey(Schema.String) },
  { message: ({ reason }) => reason ?? 'the refund was not made' },
) {}
