import { describe, expect, it } from 'vitest';

import {
  VENDOR_DOES_NOT_SHIP,
  VENDOR_DOES_NOT_TAKE_LINKS,
  VendorDoesNotShip,
  VendorDoesNotTakeLinks,
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

describe('VendorDoesNotTakeLinks', () => {
  it('names the vendor under its catalog code', () => {
    const refusal = new VendorDoesNotTakeLinks({ vendorId: 'v-1' });
    expect(refusal.code).toBe(VENDOR_DOES_NOT_TAKE_LINKS);
    expect(refusal.message).toBe('vendor v-1 does not take payment links');
  });
});
