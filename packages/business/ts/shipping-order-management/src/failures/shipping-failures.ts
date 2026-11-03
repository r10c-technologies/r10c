import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The code a participant answers when a shipment cannot make the move asked
 * of it — named because the delivery flow's fragments read it off a refusal.
 */
export const SHIPPING_ORDER_NOT_TRANSITIONABLE = 'shippingOrderNotTransitionable';

/**
 * A move the shipment's status does not allow: a dispatch landing on a held
 * order, a hold landing on a dispatched one, a delivery recorded twice. A
 * conflict with the record as it stands, never a malformed request.
 */
export class ShippingOrderNotTransitionable extends Failure.conflict<ShippingOrderNotTransitionable>()(
  'ShippingOrderNotTransitionable',
  SHIPPING_ORDER_NOT_TRANSITIONABLE,
  {
    shippingOrderId: Schema.String,
    standing: Schema.String,
    transition: Schema.String,
  },
  {
    message: ({ standing, transition }) =>
      `a shipping order in '${standing}' cannot ${transition}`,
  },
) {}
