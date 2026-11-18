import { describe, expect, it } from 'vitest';

import {
  VENDOR_DOES_NOT_SHIP,
  VendorDoesNotShip,
} from './checkout-refusals.js';

describe('VendorDoesNotShip', () => {
  it('names the vendor under its catalog code', () => {
    const refusal = new VendorDoesNotShip({ vendorId: 'v-1' });
    expect(refusal.code).toBe(VENDOR_DOES_NOT_SHIP);
    expect(refusal.message).toBe(
      'vendor v-1 does not ship, so it cannot sell on the storefront',
    );
  });
});
