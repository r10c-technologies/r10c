import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/** The code a storefront checkout from a seller who does not ship answers. */
export const VENDOR_DOES_NOT_SHIP = 'vendorDoesNotShip';

/**
 * A storefront basket naming a seller not provisioned for
 * `shipping-order-management`. Refused at the start, by the coordinator, from
 * the entitlements it verified: before this, such a sale became an order with
 * no shipment, which nothing would ever move
 * ([ADR 0076](../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §3).
 */
export class VendorDoesNotShip extends Failure.declined<VendorDoesNotShip>()(
  'VendorDoesNotShip',
  VENDOR_DOES_NOT_SHIP,
  { vendorId: Schema.String },
  {
    message: ({ vendorId }) =>
      `vendor ${vendorId} does not ship, so it cannot sell on the storefront`,
  },
) {}
