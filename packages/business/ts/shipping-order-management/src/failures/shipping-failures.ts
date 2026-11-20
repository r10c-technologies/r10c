import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The code a participant answers when a shipment cannot make the move asked
 * of it — named because the delivery flow's fragments read it off a refusal.
 */
export const SHIPPING_ORDER_NOT_TRANSITIONABLE =
  'shippingOrderNotTransitionable';

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

/**
 * A dispatch asked for before the parcel's guide was recorded. The buyer
 * follows a parcel by its guide, so one that leaves without it is one nobody
 * can follow (ADR 0081 §11). A conflict with the shipment as it stands: record
 * the guide, then dispatch.
 */
export class GuideMissing extends Failure.conflict<GuideMissing>()(
  'GuideMissing',
  'guideMissing',
  { shippingOrderId: Schema.String },
  {
    message: ({ shippingOrderId }) =>
      `shipping order ${shippingOrderId} has no guide recorded`,
  },
) {}

/**
 * A guide the shipment cannot carry: no tracking number or one too long, a
 * courier nobody configured, or a tracking page that is not `https`
 * (ADR 0081 §10). `field` names which member, for the form to point at.
 */
export class InvalidGuide extends Failure.invalid<InvalidGuide>()(
  'InvalidGuide',
  'invalidGuide',
  { field: Schema.String, reason: Schema.String },
  { message: ({ reason }) => reason },
) {}
