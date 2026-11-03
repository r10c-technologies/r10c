import { describe, expect, it } from 'vitest';

import { SHIPPING_ORDER_DOMAIN } from './domain.js';

describe('SHIPPING_ORDER_DOMAIN', () => {
  it('matches the package name, the permission namespace and the entitlement key', () => {
    expect(SHIPPING_ORDER_DOMAIN).toBe('shipping-order-management');
  });
});
